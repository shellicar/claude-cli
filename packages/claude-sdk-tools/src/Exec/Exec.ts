import type { ToolDefinition } from '@shellicar/claude-sdk';
import { builtinRules } from './builtinRules';
import { execute } from './execute';
import { normaliseInput } from './normaliseInput';
import { ExecInputSchema, ExecToolDescription } from './schema';
import { stripAnsi } from './stripAnsi';
import type { ExecOutput } from './types';
import { validate } from './validate';

export const Exec: ToolDefinition<typeof ExecInputSchema, ExecOutput> = {
  name: 'Exec',
  operation: 'write',
  description: ExecToolDescription,
  input_schema: ExecInputSchema,
  input_examples: [
    {
      description: 'Run tests',
      steps: [{ commands: [{ program: 'pnpm', args: ['test'] }] }],
    },
    {
      description: 'Check git status',
      steps: [{ commands: [{ program: 'git', args: ['status'] }] }],
    },
    {
      description: 'Run tests in a specific package',
      steps: [{ commands: [{ program: 'pnpm', args: ['test'], cwd: '~/repos/my-project/packages/my-pkg' }] }],
    },
  ],
  handler: async (input): Promise<ExecOutput> => {
    const cwd = process.cwd();
    const normalised = normaliseInput(input);
    const allCommands = normalised.steps.flatMap((s) => s.commands);
    const { allowed, errors } = validate(allCommands, builtinRules);

    if (!allowed) {
      return {
        results: [{ stdout: '', stderr: `BLOCKED:\n${errors.join('\n')}`, exitCode: 1, signal: null }],
        success: false,
      };
    }

    const result = await execute(normalised, cwd);
    const clean = input.stripAnsi ? stripAnsi : (s: string) => s;

    return {
      results: result.results.map((r) => ({
        ...r,
        stdout: clean(r.stdout).trimEnd(),
        stderr: clean(r.stderr).trimEnd(),
      })),
      success: result.success,
    };
  },
};
