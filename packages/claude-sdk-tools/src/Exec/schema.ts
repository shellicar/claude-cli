import { z } from 'zod';
import type { Command } from './types';

// --- Redirect: structured output redirection ---
export const RedirectSchema = z
  .object({
    path: z
      .string()
      .describe('File path to redirect output to. Supports ~ and $VAR expansion.')
      .meta({ examples: ['/tmp/output.txt', '~/build.log'] }),
    stream: z.enum(['stdout', 'stderr', 'both']).default('stdout').describe('Which output stream to redirect'),
    append: z.boolean().default(false).describe('Append to file instead of overwriting'),
  })
  .strict();

// --- Atomic command: one program invocation ---
export const CommandSchema = z
  .object({
    program: z
      .string()
      .describe('The program, binary, or script path to execute. Supports ~ and $VAR expansion. Must be on $PATH or an absolute path — no shell expansion of globs or operators.')
      .meta({ examples: ['git', 'node', '~/.local/bin/script.sh'] }),
    args: z
      .array(z.string())
      .default([])
      .describe('Arguments to the program. Each argument is a separate string — no shell quoting or escaping needed. Note: ~ and $VAR are NOT expanded in args. Use absolute paths or let the program resolve them.')
      .meta({ examples: [['status'], ['commit', '-m', 'Fix bug'], ['--filter', 'mcp-exec', 'build']] }),
    stdin: z
      .string()
      .optional()
      .describe('Content to pipe to stdin. Use instead of heredocs.')
      .meta({ examples: ['console.log(process.version)', '{"key":"value"}'] }),
    redirect: RedirectSchema.optional().describe('Redirect output to a file'),
    cwd: z
      .string()
      .optional()
      .describe('Working directory for this command. Supports ~ and $VAR expansion.')
      .meta({ examples: ['~/projects/my-app', '/home/user/repos/api', '$HOME/workspace'] }),
    env: z
      .record(z.string(), z.string())
      .optional()
      .describe('Environment variables to set for this command.')
      .meta({ examples: [{ NODE_ENV: 'production' }, { NO_COLOR: '1', FORCE_COLOR: '0' }] }),
    merge_stderr: z.boolean().default(false).describe('Merge stderr into stdout (equivalent to 2>&1). Combined output appears in stdout; stderr will be empty.'),
  })
  .strict();

// --- Step: one or more commands (1 = single command, 2+ = pipeline) ---
export const StepSchema = z
  .object({
    commands: z
      .array(CommandSchema)
      .min(1)
      .transform((x) => x as [Command, ...Command[]])
      .describe('Commands to execute. A single command runs directly; two or more commands are connected as a pipeline (stdout → stdin).')
      .meta({
        examples: [
          [{ program: 'git', args: ['status'] }],
          [
            { program: 'echo', args: ['hello'] },
            { program: 'wc', args: ['-w'] },
          ],
        ],
      }),
  })
  .strict();

// --- Tool-level description (passed to registerTool, not embedded in inputSchema) ---
export const ExecToolDescription = `Use this instead of the \`Bash\` tool.
Execute commands with structured input. No shell syntax needed.
Example: {"description": "Human readable description","steps": [{"commands": [{ "program": "git", "args": ["status"], "cwd": "/path" }]}]}`;

// --- The full tool input schema ---
export const ExecInputSchema = z
  .object({
    description: z
      .string()
      .describe('Human-readable summary of what these commands do, so the user can understand the intent at a glance.')
      .meta({ examples: ['Check git status', 'Build and run tests', 'Find all TypeScript errors'] }),
    steps: z.array(StepSchema).min(1).describe('Commands to execute in order'),
    chaining: z.enum(['sequential', 'independent', 'bail_on_error']).default('bail_on_error').describe('sequential: run all (;). bail_on_error: stop on first failure (&&). independent: run all, report each.'),
    timeout: z
      .number()
      .max(600000)
      .optional()
      .describe('Timeout in ms (max 600000)')
      .meta({ examples: [30000, 120000, 300000] }),
    background: z.boolean().default(false).describe('Run in background, collect results later'),
    stripAnsi: z.boolean().default(true).describe('Strip ANSI escape codes from output (default: true). Set false to preserve raw color/formatting codes.'),
  })
  .strict();

export const StepResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
});

export const ExecuteResultSchema = z.object({
  step: z.number().int(),
  command: z.string(),
  exitCode: z.number().int().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  signal: z.string().optional(),
});

export const ExecOutputSchema = z.object({
  results: StepResultSchema.array(),
  success: z.boolean(),
});
