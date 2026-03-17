import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { BashPlusPlusInputSchema } from './schema.js';
import type { BashPlusPlusInput } from './schema.js';
import { execute } from './executor.js';
import { validate, builtinRules } from './validation.js';
import type { ValidationRule } from './validation.js';

export interface BashPlusPlusOptions {
  /** Working directory for command execution. Defaults to process.cwd(). */
  cwd?: string;
  /** Custom validation rules. Defaults to builtinRules. */
  rules?: ValidationRule[];
}

/**
 * Creates an in-process MCP server providing the Bash++ structured command tool.
 *
 * Usage:
 * ```typescript
 * const bashpp = createBashPlusPlusMcpServer({ cwd: process.cwd() });
 * // Pass to SDK options:
 * // mcpServers: { 'bash-pp': bashpp }
 * // disallowedTools: ['Bash']
 * ```
 */
export function createBashPlusPlusMcpServer(options?: BashPlusPlusOptions) {
  const cwd = options?.cwd ?? process.cwd();
  const rules = options?.rules ?? builtinRules;

  const shellTool = tool(
    'Shell',
    `Execute commands with structured input. No shell syntax needed.

Each command is specified as { program, args[] } — no quoting, no escaping.
Use stdin field instead of heredocs. Use redirect for output redirection.
Multiple commands go in steps[] with chaining control (bail_on_error, sequential, independent).
Pipelines connect commands via stdout→stdin.

Examples:
- Single: { steps: [{ type: "command", program: "git", args: ["status"] }] }
- Chained: { steps: [{ type: "command", program: "pnpm", args: ["build"] }, { type: "command", program: "pnpm", args: ["test"] }], chaining: "bail_on_error" }
- Pipeline: { steps: [{ type: "pipeline", commands: [{ program: "grep", args: ["-r", "TODO", "src/"] }, { program: "wc", args: ["-l"] }] }] }
- Stdin: { steps: [{ type: "command", program: "node", args: ["script.js"], stdin: "input data" }] }
- Redirect: { steps: [{ type: "command", program: "curl", args: ["-s", "https://api.example.com"], redirect: { path: "/tmp/out.json" } }] }`,
    BashPlusPlusInputSchema,
    async (args) => {
      const input = args as unknown as BashPlusPlusInput;

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

      // Format output
      const output: string[] = [];
      for (let i = 0; i < result.results.length; i++) {
        const r = result.results[i];
        const step = input.steps[i];
        const label = step.type === 'command' ? step.program : `pipeline(${step.commands.map((c) => c.program).join(' | ')})`;

        if (result.results.length > 1) {
          output.push(`--- Step ${i + 1}: ${label} (exit ${r.exitCode}) ---`);
        }
        if (r.stdout) output.push(r.stdout);
        if (r.stderr) output.push(`stderr: ${r.stderr}`);
        if (r.exitCode !== 0 && !r.stdout && !r.stderr) {
          output.push(`Command exited with code ${r.exitCode}`);
        }
      }

      return {
        content: [{ type: 'text' as const, text: output.join('\n').trimEnd() || '(no output)' }],
        isError: !result.success,
      };
    },
  );

  return createSdkMcpServer({
    name: 'bash-pp',
    version: '0.1.0',
    tools: [shellTool],
  });
}
