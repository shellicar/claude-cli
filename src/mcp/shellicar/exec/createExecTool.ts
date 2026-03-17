import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ShellicarExecDescription, ShellicarExecToolName } from '../consts';
import { validate } from '../validation/validate';
import { execute } from './execute';
import { ShellicarExecInputSchema } from './schema';
import { stripAnsi } from './stripAnsi';
import type { ExecToolArgs, ExecuteResult, ValidationRule } from './types';

export const createExecTool = (cwd: string, rules: ValidationRule[]) => {
  const handle = async (args: ExecToolArgs): Promise<CallToolResult> => {
    const input = ShellicarExecInputSchema.parse(args);

    // Validate against rules
    const { allowed, errors } = validate(input.steps, rules);
    if (!allowed) {
      return {
        content: [{ type: 'text' as const, text: `BLOCKED:\n${errors.join('\n')}` }],
        isError: true,
      };
    }

    // Execute
    const result = await execute(input, cwd);

    // Format output — one content block per step for structured results
    const clean = input.stripAnsi ? stripAnsi : (s: string) => s;
    const content = result.results.map((r, i) => {
      const step = input.steps[i];
      const label = step.type === 'command' ? step.program : `pipeline(${step.commands.map((c) => c.program).join(' | ')})`;

      const stdout = clean(r.stdout).trimEnd();
      const stderr = clean(r.stderr).trimEnd();
      const stepOutput = JSON.stringify({
        step: i + 1,
        command: label,
        exitCode: r.exitCode ?? undefined,
        stdout,
        stderr,
        signal: r.signal ?? undefined,
      } satisfies ExecuteResult);

      return { type: 'text' as const, text: stepOutput };
    });

    return {
      content: content.length > 0 ? content : [{ type: 'text' as const, text: '(no output)' }],
      isError: !result.success,
    };
  };
  return tool(ShellicarExecToolName, ShellicarExecDescription, ShellicarExecInputSchema.shape, handle);
};
