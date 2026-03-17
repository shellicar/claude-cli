import { z } from 'zod';

// --- Redirect: structured output redirection ---
export const RedirectSchema = z.object({
  /** File path to redirect to */
  path: z.string().describe('File path to redirect output to'),
  /** Which stream to redirect */
  stream: z.enum(['stdout', 'stderr', 'both']).default('stdout').describe('Which output stream to redirect'),
  /** Append instead of overwrite */
  append: z.boolean().default(false).describe('Append to file instead of overwriting'),
});

// --- Atomic command: one program invocation ---
export const CommandSchema = z.object({
  /** The program to execute */
  program: z.string().describe('The program/binary to execute'),
  /** Arguments as an array — no shell escaping needed */
  args: z.array(z.string()).default([]).describe('Arguments to the program'),
  /** Optional stdin content — replaces heredocs entirely */
  stdin: z.string().optional().describe('Content to pipe to stdin (replaces heredocs)'),
  /** Optional output redirection */
  redirect: RedirectSchema.optional().describe('Redirect output to a file'),
  /** Optional working directory override */
  cwd: z.string().optional().describe('Working directory for this command'),
  /** Optional environment variables */
  env: z.record(z.string()).optional().describe('Environment variables to set'),
});

// --- Pipeline: commands connected by pipes ---
export const PipelineSchema = z.object({
  type: z.literal('pipeline'),
  /** Ordered list of commands, stdout of each piped to stdin of next */
  commands: z.array(CommandSchema).min(2).describe('Commands connected by pipes (stdout → stdin)'),
});

// --- Single command (no piping) ---
export const SingleCommandSchema = z.object({
  type: z.literal('command'),
  ...CommandSchema.shape,
});

// --- A step is either a single command or a pipeline ---
export const StepSchema = z.discriminatedUnion('type', [SingleCommandSchema, PipelineSchema]);

// --- The full tool input schema (flat for MCP tool registration) ---
export const BashPlusPlusInputSchema = {
  /** Human-readable description of what these commands do */
  description: z.string().describe('Brief description of what these commands do'),
  /** The commands to execute */
  steps: z.array(StepSchema).min(1).describe('Commands to execute in order'),
  /** How to chain multiple steps */
  chaining: z
    .enum(['sequential', 'independent', 'bail_on_error'])
    .default('bail_on_error')
    .describe('sequential: run all (;). bail_on_error: stop on first failure (&&). independent: run all, report each.'),
  /** Optional timeout in milliseconds */
  timeout: z.number().max(600000).optional().describe('Timeout in ms (max 600000)'),
  /** Run in background */
  background: z.boolean().default(false).describe('Run in background, collect results later'),
};

// Inferred types
export type Redirect = z.infer<typeof RedirectSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type Pipeline = z.infer<typeof PipelineSchema>;
export type SingleCommand = z.infer<typeof SingleCommandSchema>;
export type Step = z.infer<typeof StepSchema>;
export type BashPlusPlusInput = {
  description: string;
  steps: Step[];
  chaining: 'sequential' | 'independent' | 'bail_on_error';
  timeout?: number;
  background: boolean;
};
