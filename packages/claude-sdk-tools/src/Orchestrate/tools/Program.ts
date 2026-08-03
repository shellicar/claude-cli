import { resolve } from 'node:path';
import { PassThrough, Readable, type Writable } from 'node:stream';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { pathSchema } from '@shellicar/claude-sdk';
import { type CommandSpec, type IExecutor, PipeConsumerGone } from '@shellicar/exec-core';
import type { Ended, Operation, Reader, Running, Writer } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { stripAnsi } from '../../Exec/stripAnsi.js';
import { type IEnvProvider, PROTECTED_ENV_NAMES } from '../../exec-shared.js';

/** How much of a process's output is held before the process is made to wait. */
export const PIPE_BUFFER_BYTES = 64 * 1024;

export const ProgramModel = z.object({
  // Taken literally, unlike `args` and `cwd`: expanding it would mean a rule about which program
  // may run had to police a name decided later.
  program: z.string().min(1).describe('The program to execute. Taken literally: no ~ or $VAR expansion, unlike args and cwd. Must be on the PATH or an absolute path.'),
  args: z.array(z.string()).optional(),
  cwd: pathSchema.optional().describe('Working directory for this command. Defaults to the current working directory when omitted.'),
  env: z
    .record(z.string(), z.string())
    .optional()
    .refine((env) => env == null || Object.keys(env).every((name) => !PROTECTED_ENV_NAMES.includes(name as (typeof PROTECTED_ENV_NAMES)[number])), {
      message: `these environment variables cannot be set for a command, because the engine will not honour them and the command would differ from the one asked for: ${PROTECTED_ENV_NAMES.join(', ')}`,
    }),
  /** A literal here-string, used only when nothing is piped in. */
  stdin: z.string().optional(),
  /** Writes a stream to a file instead of sending it on. A relative path resolves against this
   *  call's own `cwd`. */
  redirect: z.object({ stdout: pathSchema.optional(), stderr: pathSchema.optional() }).optional(),
  /** Kills this command after this many milliseconds, whatever the run's own limit. */
  timeout: z.number().int().positive().optional(),
  /** Keeps escape codes, for a command whose colour is the point. */
  stripAnsi: z.boolean().optional(),
});

type ProgramInput = z.infer<typeof ProgramModel>;

type Deps = { sleep?: (ms: number, signal: AbortSignal) => Promise<void> };

/** Reads a stream a line at a time, so a filter applies to a line rather than to whatever a chunk
 *  boundary happened to cut. A line longer than the buffer is passed on as it stands. */
function onEachLine(from: NodeJS.ReadableStream, take: (line: string, terminated: boolean) => void): Promise<void> {
  // Latin-1 throughout: one byte in, one byte out, so what a process wrote arrives as it wrote it
  // even when it is not text at all. Escape sequences are ASCII, so stripping still works.
  let partial = '';
  return new Promise<void>((resolve) => {
    from.on('data', (chunk: Buffer) => {
      partial += chunk.toString('binary');
      let index = partial.indexOf('\n');
      while (index >= 0) {
        take(partial.slice(0, index), true);
        partial = partial.slice(index + 1);
        index = partial.indexOf('\n');
      }
      if (partial.length >= PIPE_BUFFER_BYTES) {
        take(partial, false);
        partial = '';
      }
    });
    from.on('end', () => {
      if (partial.length > 0) {
        take(partial, false);
      }
      resolve();
    });
  });
}

function readerAsStream(from: Reader): Readable {
  return Readable.from(
    (async function* () {
      for (let chunk = await from.read(); chunk != null; chunk = await from.read()) {
        yield chunk;
      }
    })(),
    { objectMode: false },
  );
}

/** How the process ended, in the run's own terms. */
function endedAs(exitCode: number | null, signal: string | null): Ended {
  if (signal != null) {
    return { kind: 'signalled', signal };
  }
  return exitCode === 0 ? { kind: 'finished' } : { kind: 'failed', code: exitCode ?? 1 };
}

/** Spawns one process. Its bytes go down, its stderr is captured, its exit is how the stage ended,
 *  and closing its output kills it the way a departing reader kills a process in a pipeline. */
export function createProgramTool(executor: IExecutor, fs: IFileSystem, envProvider: IEnvProvider, deps: Deps = {}) {
  return {
    name: 'Program',
    // A redirect writes a file, so a call that has one is a write as well as an execution.
    operations: (input: Record<string, unknown>): Operation[] => {
      const redirect = (input as ProgramInput).redirect;
      return redirect?.stdout != null || redirect?.stderr != null ? ['fs.exec', 'fs.write'] : ['fs.exec'];
    },
    takesListIn: 'args',

    run: (raw: Record<string, unknown>, upstream: Reader | undefined, out: Writer, say: (line: string, options?: { captured?: boolean }) => void): Running => {
      const input = raw as ProgramInput;
      const cwd = input.cwd ?? fs.cwd();
      const clean = input.stripAnsi === false ? (line: string) => line : stripAnsi;
      const env = envProvider.buildEnv(input.env);
      const controller = new AbortController();

      const stdout = new PassThrough({ highWaterMark: PIPE_BUFFER_BYTES });
      const stderr = new PassThrough({ highWaterMark: PIPE_BUFFER_BYTES });
      const toFile = (path: string): Writable => fs.createWriteStream(resolve(cwd, path), { flags: 'w' });
      const stdoutFile = input.redirect?.stdout != null ? toFile(input.redirect.stdout) : undefined;
      const stderrFile = input.redirect?.stderr != null ? toFile(input.redirect.stderr) : undefined;

      // Redirected output belongs to the file, so the stage sends nothing on, the way a redirected
      // command shows nothing on a terminal.
      const wrote: Promise<unknown>[] = [];
      const sentOn = onEachLine(stdout, (line, terminated) => {
        const text = terminated ? `${clean(line)}\n` : clean(line);
        if (stdoutFile != null) {
          stdoutFile.write(text, 'binary');
          return;
        }
        wrote.push(out.write(Buffer.from(text, 'binary')));
      });
      const captured = onEachLine(stderr, (line) => {
        const text = clean(line);
        if (stderrFile != null) {
          stderrFile.write(`${text}\n`, 'binary');
          return;
        }
        say(text, { captured: true });
      });

      let exit: Ended = { kind: 'finished' };
      let finished = false;

      const running = executor
        .run({ program: input.program, args: input.args, cwd, env } satisfies CommandSpec, { stdout, stderr, stdin: upstream != null ? readerAsStream(upstream) : input.stdin != null ? Readable.from(input.stdin) : undefined, signal: controller.signal })
        .then((status) => {
          exit = endedAs(status.exitCode, status.signal);
        })
        .catch((err: unknown) => {
          out.fail(err);
        })
        .finally(async () => {
          finished = true;
          // Everything the process wrote has to have been read and passed on before the output is
          // ended: a last line with no newline on it arrives after the process itself is gone.
          await Promise.all([sentOn, captured]);
          await Promise.all(wrote);
          stdoutFile?.end();
          stderrFile?.end();
          out.end();
        });

      if (input.timeout != null && deps.sleep != null) {
        void deps.sleep(input.timeout, controller.signal).then(() => {
          if (!finished) {
            say(`timed out after ${input.timeout}ms`);
            controller.abort(new Error('timed out'));
          }
        });
      }

      return {
        ended: () => exit,
        stop: async () => {
          // A relayed pipe gives a spawned process no SIGPIPE of its own, so it is sent here.
          if (!finished) {
            controller.abort(PipeConsumerGone);
          }
          await running;
        },
      };
    },
  };
}
