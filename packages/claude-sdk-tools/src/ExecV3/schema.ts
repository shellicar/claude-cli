import { pathSchema } from '@shellicar/claude-sdk/pathSchema';
import { z } from 'zod';

// --- redirect: named keys, not an array (design § redirect) ---
// stdout: overwrite-only path. stderr: a path OR the literal "&1" (= "go where
// stdout goes", folding in 2>&1). Two keys → "two destinations for one stream" is
// unrepresentable, so no validation rule is needed for that case.
export const RedirectSchema = z
  .object({
    // Not marked as a path: a redirect target is relative to this command's own cwd, not the CLI's,
    // so it is expanded by the Exec normaliser (see normaliseCommands) and resolved against the
    // command cwd in runPipeline, rather than the SDK path marker.
    stdout: z
      .string()
      .optional()
      .describe('Redirect stdout to this file path (overwrite). ~ and $VAR expanded. For append or fd-level redirects, use a script.')
      .meta({ examples: ['/tmp/out.log', '~/build.log'] }),
    stderr: z
      .string()
      .optional()
      .describe('Redirect stderr to a file path, OR the literal "&1" to merge stderr into wherever stdout goes (2>&1). ~ and $VAR expanded.')
      .meta({ examples: ['/tmp/err.log', '&1'] }),
  })
  .strict();

// --- command: one program invocation, with a forward-pointing op ---
export const CommandSchema = z
  .object({
    program: z
      .string()
      .min(1)
      .describe('The program, binary, or script path to execute. Supports ~ and $VAR expansion. Must be on $PATH or an absolute path — no shell expansion of globs or operators.')
      .meta({ examples: ['git', 'node', 'pnpm'] }),
    args: z
      .array(z.string())
      .default([])
      .describe('Arguments to the program. Each argument is a separate string — no shell quoting. ~ and $VAR are NOT expanded in args.')
      .meta({ examples: [['status'], ['commit', '-m', 'Fix bug']] }),
    op: z
      .enum(['&&', '||', '|'])
      .optional()
      .describe(
        'How THIS command joins the NEXT one (forward-pointing). "&&" run next if this succeeds; "||" run next if this fails; "|" pipe this stdout into next stdin. Absent = sequential (run next regardless). Bash precedence: "|" binds tightest, then "&&"/"||" (equal, left-associative). Omit on the last command.',
      ),
    cwd: pathSchema
      .optional()
      .describe('Working directory for this command. Supports ~ and $VAR expansion.')
      .meta({ examples: ['~/projects/my-app', '/home/user/repos/api'] }),
    env: z
      .record(z.string(), z.string())
      .optional()
      .describe('Environment variables to set for this command (merged over the inherited environment).')
      .meta({ examples: [{ NODE_ENV: 'production' }, { NO_COLOR: '1' }] }),
    stdin: z
      .string()
      .optional()
      .describe('Literal stdin for this command (here-string / heredoc equivalent). Not allowed on the target of a pipe — the pipe owns stdin.')
      .meta({ examples: ['console.log(process.version)', '{"key":"value"}'] }),
    redirect: RedirectSchema.optional().describe("Redirect this command's stdout/stderr to files"),
  })
  .strict();

// --- input ---
// Request-level validation (design § Validation) is expressed as a superRefine on
// the whole input, because dangling-op and pipe-stdin are cross-command rules a
// per-field schema cannot see. Making the illegal shapes unparseable means Claude is
// told "invalid input" on the control channel before anything runs — the loud,
// structured rejection the design calls for.
export const ExecV3InputSchema = z
  .object({
    intent: z
      .string()
      .min(1)
      .describe('Your intent for this run: the goal, not a restatement of the command. E.g. "confirm the build is green before tagging", not "run pnpm build".')
      .meta({ examples: ['build then run the tests', 'count the TODO markers in the tree'] }),
    commands: z
      .array(CommandSchema)
      .min(1)
      .describe("Flat list of commands, joined by each command's forward-pointing `op`. One command = run it. A simple chain or a pipe stays flat — no nesting. Anything needing grouping, variables, substitution, loops or globbing is a script, not this tool.")
      .meta({
        examples: [
          [{ program: 'ls' }],
          [
            { program: 'pnpm', args: ['build'], op: '&&' },
            { program: 'pnpm', args: ['test'] },
          ],
        ],
      }),
    timeout: z
      .number()
      .min(1)
      .max(600000)
      .default(30000)
      .describe('Timeout in ms (default 30000, max 600000).')
      .meta({ examples: [30000, 120000, 300000] }),
    stripAnsi: z.boolean().default(true).describe('Strip ANSI escape codes from output (default true).'),
  })
  .strict()
  .superRefine((input, ctx) => {
    const cmds = input.commands;

    // Dangling operator: a real op on the LAST command has no next command to join.
    const last = cmds[cmds.length - 1];
    if (last?.op != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['commands', cmds.length - 1, 'op'],
        message: `dangling operator "${last.op}" on the last command — it has nothing to join to`,
      });
    }

    cmds.forEach((cmd, i) => {
      const prev = i > 0 ? cmds[i - 1] : undefined;

      // R4: a command that pipes (op "|") cannot also redirect its stdout to a file —
      // the bytes cannot both feed the pipe and be written. Use tee.
      if (cmd.op === '|' && cmd.redirect?.stdout != null) {
        ctx.addIssue({
          code: 'custom',
          path: ['commands', i, 'redirect', 'stdout'],
          message: 'a command with op "|" cannot also redirect stdout to a file; pipe into `tee` instead',
        });
      }

      // NE2: stdin literal on the TARGET of a pipe (previous command had op "|") —
      // the pipe occupies stdin.
      if (prev?.op === '|' && cmd.stdin != null) {
        ctx.addIssue({
          code: 'custom',
          path: ['commands', i, 'stdin'],
          message: 'stdin is not allowed on the target of a pipe; the pipe owns stdin',
        });
      }
    });
  });

// --- result (design § Result) ---
export const CommandResultSchema = z.object({
  stdout: z.string(), // "" on a non-terminal pipe stage (consumed downstream)
  stderr: z.string(), // captured per command, even inside a pipe
  exitCode: z.number().int().nullable(), // null when signal-killed
  signal: z.string().nullable(),
  durationMs: z.number(), // wall-clock from spawn to settle for this stage
});

export const ExecV3OutputSchema = z.object({
  // .nullable(): a short-circuited command's slot is `null`. The array length always
  // matches `commands` (results[i] ↔ commands[i]); `null` = commands[i] never ran, which
  // keeps `exitCode: null` meaning only "signal-killed". Read with results[i]?.exitCode.
  results: CommandResultSchema.nullable().array(),
  success: z.boolean(), // $? == 0 under bash list exit status (see engine)
  durationMs: z.number(), // wall-clock for the whole run; NOT the sum of per-command durationMs, which overlap inside a pipe
});

export const ExecV3ToolDescription = `Run commands with structured input — no shell, no quoting, no string-splitting.

Give a flat \`commands\` list. Each command joins the NEXT via its \`op\`:
  • absent  → sequential (run next regardless)        bash: \`;\`
  • "&&"    → run next only if this succeeds           bash: \`&&\`
  • "||"    → run next only if this fails              bash: \`||\`
  • "|"     → pipe this stdout into the next stdin     bash: \`|\`

Precedence is bash's, exactly: "|" binds tightest, then "&&"/"||" (equal, left to
right). \`a && b || c\` means \`(a && b) || c\`. Omit \`op\` on the last command.

\`results\` has one slot per command, position-aligned to \`commands\` (results[i] is
commands[i]); a command that was short-circuited (skipped) is \`null\`, so read it
defensively (results[i]?.exitCode). \`success\` is the exit status of the last command
that actually ran, bash-style. Per-command exit/stderr/durationMs is always in \`results\`,
so a pipe's per-stage truth is never lost. The top-level \`durationMs\` is the whole run's
wall-clock — it is NOT the sum of the per-command values, since stages inside a pipe run
concurrently and overlap.

Anything needing grouping, variables, \`$(...)\`, loops or globbing is a script — write
it to a file and run the file. Redirect is overwrite-only ({ stdout, stderr }; stderr
"&1" folds 2>&1); append/fd-level redirects are a script.`;
