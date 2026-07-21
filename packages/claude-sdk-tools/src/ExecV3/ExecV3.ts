import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk/defineTool';
import { ToolCancelledError } from '@shellicar/claude-sdk/ToolCancelledError';
import { ToolRefusedError } from '@shellicar/claude-sdk/ToolRefusedError';
import type { IExecutor } from '@shellicar/exec-core';
import { z } from 'zod';
import { commandMatches } from '../Exec/commandMatches';
import { IRulesConfigProvider, StaticRulesConfigProvider } from '../Exec/IRulesConfigProvider';
import { buildExecRules, defaultRules, resolveRules } from '../Exec/ruleConfig';
import { stripAnsi } from '../Exec/stripAnsi';
import type { ExecRule } from '../Exec/types';
import { validate } from '../Exec/validate';
import { execSignal, type IEnvProvider } from '../exec-shared';
import { evaluate } from './engine';
import { normaliseCommands } from './normalise';
import { ExecV3InputSchema, ExecV3OutputSchema, ExecV3ToolDescription } from './schema';

/** A configured command pattern that ExecV3 refuses to start. Program must match and every arg must appear in order. */
export type BlockedCommand = { program: string; args: string[] };

/** The canonical schema for `BlockedCommand` — the single source of truth `rulesSection.ts`
 *  (internal validation) and the app's `cli-config/schema.ts` (user-facing config + generated
 *  JSON Schema) both build on. */
export const blockedCommandSchema = z.object({
  program: z.string().describe('Program name to match exactly'),
  args: z.array(z.string()).optional().default([]).describe('Args that must all appear, in order (an ordered subsequence), for the block to apply. Empty matches on program alone.'),
});

function blockedCommandRules(blocked: BlockedCommand[]): ExecRule[] {
  return blocked.map((pattern) => ({
    name: `blocked-command:${[pattern.program, ...pattern.args].join(' ')}`,
    check: (commands) => {
      for (const cmd of commands) {
        if (commandMatches(cmd, pattern)) {
          return `'${[pattern.program, ...pattern.args].join(' ')}' is blocked by configuration. Ask the user to run it directly.`;
        }
      }
      return undefined;
    },
  }));
}

export function createExecV3(
  fs: IFileSystem,
  executor: IExecutor,
  envProvider: IEnvProvider,
  rulesProvider: IRulesConfigProvider = new StaticRulesConfigProvider(),
  now: () => number = () => performance.now(),
) {
  return defineTool({
    name: 'ExecV3',
    operation: 'write',
    description: ExecV3ToolDescription,
    input_schema: ExecV3InputSchema,
    output_schema: ExecV3OutputSchema,
    input_examples: [
      // single command — bash: ls
      { intent: 'list the working directory', commands: [{ program: 'ls' }] },

      // && chain — bash: pnpm build && pnpm test
      {
        intent: 'build, then run the tests only if the build passed',
        commands: [
          { program: 'pnpm', args: ['build'], op: '&&' },
          { program: 'pnpm', args: ['test'] },
        ],
      },

      // multi-stage pipe — bash: grep -r TODO . | wc -l
      {
        intent: 'count the TODO markers in the tree',
        commands: [
          { program: 'grep', args: ['-r', 'TODO', '.'], op: '|' },
          { program: 'wc', args: ['-l'] },
        ],
      },

      // redirect with stderr "&1" — bash: pnpm build > build.log 2>&1
      {
        intent: 'build, capturing stdout and stderr together into one log file',
        commands: [{ program: 'pnpm', args: ['build'], redirect: { stdout: 'build.log', stderr: '&1' } }],
      },

      // mixed operators (left-to-right) — bash: pnpm lint && pnpm test || echo 'checks failed'
      {
        intent: 'lint then test, and announce if either step fails',
        commands: [
          { program: 'pnpm', args: ['lint'], op: '&&' },
          { program: 'pnpm', args: ['test'], op: '||' },
          { program: 'echo', args: ['checks failed'] },
        ],
      },

      // realistic composite — bash: (in the package dir) grep -rn TODO src | sort > todos.txt
      {
        intent: 'collect and sort the TODO markers from one package into a file',
        commands: [
          { program: 'grep', args: ['-rn', 'TODO', 'src'], cwd: '~/repos/app/packages/api', op: '|' },
          { program: 'sort', redirect: { stdout: 'todos.txt' } },
        ],
      },
    ] satisfies z.input<typeof ExecV3InputSchema>[],
    handler: async (input, signal) => {
      const cwd = process.cwd();
      const commands = normaliseCommands(input.commands, fs);

      // Rules are read fresh on every call, not captured at tool-construction time — the same
      // "read fresh, not pushed" contract as IDisabledToolsProvider — so a config reload is
      // reflected on the very next call with no restart and no notification needed.
      // Blocked-program rule reuses V1 builtinRules, which read only program/args.
      // A blocked program is a can't-start rejection: thrown as a ToolRefusedError and
      // surfaced as a `refused` outcome, not a fabricated command result.
      const rules = [...buildExecRules(resolveRules(defaultRules, rulesProvider.rules)), ...blockedCommandRules(rulesProvider.blockedCommands)];
      const { allowed, errors } = validate(
        commands.map((c) => ({ program: c.program, args: c.args, merge_stderr: false })),
        rules,
      );
      if (!allowed) {
        throw new ToolRefusedError(errors.join('\n'));
      }

      const result = await evaluate(commands, { cwd, signal: execSignal(signal, input.timeout), executor, envProvider, now, fs });
      if (signal?.aborted) {
        throw new ToolCancelledError();
      }

      const clean = input.stripAnsi ? stripAnsi : (s: string) => s;
      return {
        textContent: {
          results: result.results.map((r) => (r == null ? null : { ...r, stdout: clean(r.stdout).trimEnd(), stderr: clean(r.stderr).trimEnd() })),
          success: result.success,
          durationMs: result.durationMs,
        },
      };
    },
  });
}
