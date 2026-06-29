import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool, ToolCancelledError } from '@shellicar/claude-sdk';
import type { IExecutor } from '@shellicar/exec-core';
import type { z } from 'zod';
import { builtinRules } from '../Exec/builtinRules';
import { stripAnsi } from '../Exec/stripAnsi';
import { validate } from '../Exec/validate';
import { execSignal } from '../exec-shared';
import { evaluate } from './engine';
import { normaliseCommands } from './normalise';
import { ExecV3InputSchema, ExecV3OutputSchema, ExecV3ToolDescription } from './schema';

export function createExecV3(fs: IFileSystem, executor: IExecutor) {
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

      // Blocked-program rule reuses V1 builtinRules, which read only program/args.
      // Returned as a structured BLOCKED result, matching V1/V2 (plan §8 / G3).
      const { allowed, errors } = validate(
        commands.map((c) => ({ program: c.program, args: c.args, merge_stderr: false })),
        builtinRules,
      );
      if (!allowed) {
        return {
          textContent: {
            results: [{ stdout: '', stderr: `BLOCKED:\n${errors.join('\n')}`, exitCode: 1, signal: null }],
            success: false,
          },
        };
      }

      const result = await evaluate(commands, { cwd, signal: execSignal(signal, input.timeout), executor });
      if (signal?.aborted) {
        throw new ToolCancelledError();
      }

      const clean = input.stripAnsi ? stripAnsi : (s: string) => s;
      return {
        textContent: {
          results: result.results.map((r) => (r == null ? null : { ...r, stdout: clean(r.stdout).trimEnd(), stderr: clean(r.stderr).trimEnd() })),
          success: result.success,
        },
      };
    },
  });
}
