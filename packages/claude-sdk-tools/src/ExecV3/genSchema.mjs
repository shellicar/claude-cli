// Throwaway generator for a test JSON Schema of the ExecV3 input shape.
// Not the final schema — structural only. Run: node genSchema.mjs
import { z } from 'zod';
import { writeFileSync } from 'node:fs';

const RedirectSchema = z
  .object({
    stdout: z.string().describe('Path to send stdout to (overwrite). ~ and $VAR expanded.').optional(),
    stderr: z
      .string()
      .describe('Path to send stderr to, OR the literal "&1" to merge stderr into stdout (2>&1).')
      .optional(),
  })
  .strict();

const CommandSchema = z
  .object({
    program: z.string().describe('Program/binary to execute. ~ and $VAR expanded. No shell.'),
    args: z.array(z.string()).default([]).describe('Arguments, each a separate literal string. No shell quoting.'),
    op: z
      .enum(['&&', '||', '|'])
      .optional()
      .describe('How this command joins the NEXT. Absent = sequential. Precedence: | tightest, then &&/||. Absent on the last command = terminator.'),
    cwd: z.string().optional().describe('Working directory. ~ and $VAR expanded.'),
    env: z.record(z.string(), z.string()).optional().describe('Environment variables for this command.'),
    stdin: z.string().optional().describe('Literal stdin for this command.'),
    redirect: RedirectSchema.optional().describe('Per-command output redirection.'),
  })
  .strict();

const ExecV3InputSchema = z
  .object({
    description: z.string().describe('Human-readable summary of what these commands do.'),
    commands: z.array(CommandSchema).min(1).describe("Flat list of commands, joined left-to-right by each command's op."),
    timeout: z.number().max(600000).default(30000).describe('Timeout in ms (default 30000, max 600000).'),
    stripAnsi: z.boolean().default(true).describe('Strip ANSI escape codes from output (default true).'),
  })
  .strict();

const jsonSchema = z.toJSONSchema(ExecV3InputSchema, { io: 'input' });
const out = new URL('./execv3.schema.json', import.meta.url);
writeFileSync(out, JSON.stringify(jsonSchema, null, 2) + '\n');
console.log('wrote', out.pathname);
console.log('top-level required:', jsonSchema.required);
console.log('per-command required:', jsonSchema.properties.commands.items.required);
