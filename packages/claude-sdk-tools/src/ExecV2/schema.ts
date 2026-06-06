import { z } from 'zod';

// --- Redirect ---
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

// --- Command (leaf node) ---
// The `id` field is required. It is caller-assigned and copied verbatim to the result entry.
// It is not interpreted by the executor and need not be unique within a tree.
export const CommandSchema = z
  .object({
    id: z.string().describe("Caller-assigned identifier copied verbatim to this leaf's result entry."),
    program: z
      .string()
      .describe('The program, binary, or script path to execute. Supports ~ and $VAR expansion. Must be on $PATH or an absolute path.')
      .meta({ examples: ['git', 'node', '~/.local/bin/script.sh'] }),
    args: z
      .array(z.string())
      .default([])
      .describe('Arguments to the program. Each argument is a separate string — no shell quoting or escaping needed.')
      .meta({ examples: [['status'], ['commit', '-m', 'Fix bug']] }),
    stdin: z.string().optional().describe('Content to pipe to stdin.').meta({ examples: ['console.log(process.version)', '{"key":"value"}'] }),
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

// --- Operation (inner node) ---
// Uses Zod v4's `get` accessor pattern for recursive fields. The getter is evaluated lazily
// at property access time, so the forward reference to PipelineSchema resolves correctly
// even though `const` is not hoisted. No z.lazy() or z.ZodType<T> cast needed.
//
// Note: .strict() is intentionally omitted here. Calling .strict() evaluates the shape
// eagerly, which triggers the getters while PipelineSchema is still in the temporal dead
// zone (declared with const below). Without .strict(), the getters are only called during
// parsing, at which point all schemas are fully initialised.
//
// Three cross-cutting refinements live here because they are pipe-specific constraints
// that the simple per-field schema cannot express:
//   R4  — redirect on a Command that is the direct left side of a pipe is rejected.
//         The bytes cannot both feed the pipe and be captured by the redirect; V1
//         silently ignored the redirect, which is the divergence V2 surfaces as an error.
//   NE2 — stdin literal on a Command that is the direct right side of a pipe is
//         rejected. The pipe occupies stdin; bash cannot express a heredoc on the
//         right of a pipe, so the schema mirrors that reality.
//   NE3 — an Operation (group) on the right side of a pipe is rejected at parse time.
//         Rejecting at the schema means Claude cannot construct the shape at all —
//         no wasted round-trip, no ambiguous runtime error. The runtime throw in
//         executeAsConsumer stays as a defensive backstop, but this refinement is the
//         primary gate. (SC decision 2026-06-05.)
// R4 and NE2 apply only when the side is a *direct* Command leaf; when the side is a
// group, Commands inside may carry redirect/stdin because only the group's residual
// stdout/stdin reaches the pipe. NE3 applies when the right side IS a group.
//
// `.superRefine()` is safe with the recursive getter pattern (unlike `.strict()`): it
// wraps the schema in a ZodEffects that stores the function without inspecting the shape,
// so the getters are not triggered at construction time.
export const OperationSchema = z
  .object({
    op: z.enum([';', '&&', '||', '&', '|']).describe("Operator: ';' sequence, '&&' and, '||' or, '&' concurrent, '|' pipe"),
    get left() {
      return PipelineSchema;
    },
    get right() {
      return PipelineSchema;
    },
  })
  .superRefine((val, ctx) => {
    if (val.op !== '|') return;

    // R4: direct-left-Command with stdout/both redirect.
    const left = val.left as { program?: unknown; redirect?: { stream?: string } };
    if (typeof left.program === 'string' && left.redirect !== undefined) {
      const stream = left.redirect.stream;
      if (stream === 'stdout' || stream === 'both') {
        ctx.addIssue({
          code: 'custom',
          path: ['left', 'redirect'],
          message: 'redirect on a Command that is the direct left side of a pipe is not permitted; pipe to tee instead',
        });
      }
    }

    // NE2: direct-right-Command with stdin literal.
    const right = val.right as { program?: unknown; op?: unknown; stdin?: unknown };
    if (typeof right.program === 'string' && right.stdin !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['right', 'stdin'],
        message: 'stdin literal on a Command that is the direct right side of a pipe is not permitted; the pipe occupies stdin',
      });
    }

    // NE3: Operation (group) on the right side of a pipe.
    // A group cannot receive a piped stdin in a well-defined way without threading it to
    // one specific leaf — the right side of a pipe must be a single Command. Reject at
    // schema time so Claude cannot construct this shape at all.
    if (typeof right.op === 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['right'],
        message: 'the right side of a pipe must be a single Command, not a group; pipe into a specific command',
      });
    }
  });

export const PipelineSchema = z.union([CommandSchema, OperationSchema]);

// --- Tool input ---
export const ExecV2InputSchema = z
  .object({
    description: z
      .string()
      .describe('Human-readable summary of what these commands do, so the user can understand the intent at a glance.')
      .meta({ examples: ['Check git status', 'Build and run tests', 'Find all TypeScript errors'] }),
    pipeline: PipelineSchema,
    timeout: z
      .number()
      .max(600000)
      .optional()
      .describe('Timeout in ms (max 600000)')
      .meta({ examples: [30000, 120000, 300000] }),
    stripAnsi: z.boolean().default(true).describe('Strip ANSI escape codes from output (default: true). Set false to preserve raw color/formatting codes.'),
  })
  .strict();

// --- Result and output ---
export const CommandResultSchema = z.object({
  id: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
});

export const ExecV2OutputSchema = z.object({
  results: CommandResultSchema.array(),
  success: z.boolean(),
});
