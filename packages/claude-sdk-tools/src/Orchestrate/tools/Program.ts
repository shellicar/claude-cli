import { resolve } from 'node:path';
import { PassThrough, Readable, type Writable } from 'node:stream';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { pathSchema } from '@shellicar/claude-sdk';
import type { CommandSpec, IExecutor } from '@shellicar/exec-core';
import { PipeConsumerGone } from '@shellicar/exec-core';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { stripAnsi } from '../../Exec/stripAnsi.js';
import { type IEnvProvider, PROTECTED_ENV_NAMES } from '../../exec-shared.js';
import { defineToolV2, xargsTarget } from '../defineToolV2.js';

/** How much of a running process's output is held before the process itself is made to wait, the
 *  same job a pipe's kernel buffer does and the same size Linux gives it.
 *
 *  This replaced a pair of hard limits on total output. They existed to stop a producer nothing was
 *  limiting, and there is no such producer now: one that outruns its reader waits here, and one
 *  whose reader leaves is killed when the stream closes. A producer whose reader never stops is not
 *  a memory problem at all, and `timeout` is what ends it. */
export const PIPE_BUFFER_BYTES = 64 * 1024;

export const ProgramToolV2Model = z.object({
  // Deliberately not expanded, unlike `args` and `cwd`: expanding it would mean a rule about which
  // program may run had to police a name that is decided later, so it is taken literally.
  program: z.string().min(1).describe('The program to execute. Taken literally: no ~ or $VAR expansion, unlike args and cwd. Must be on the PATH or an absolute path.'),
  // The xargs target, appended to rather than replaced, so `Program{ rm, args: ['-v'] }` fed by a
  // Find behaves like `find | xargs rm -v`.
  args: xargsTarget(z.array(z.string()).optional()),
  // Optional: real spawn() inherits the parent's cwd when none is given, and Program does the
  // same, defaulting to the injected IFileSystem's own cwd() via resolveDefaults below — never
  // baked into the schema itself, which must stay a pure data shape with no runtime dependency.
  cwd: pathSchema.optional().describe('Working directory for this command. Defaults to the current working directory when omitted.'),
  env: z
    .record(z.string(), z.string())
    .optional()
    .refine((env) => env == null || Object.keys(env).every((name) => !PROTECTED_ENV_NAMES.includes(name as (typeof PROTECTED_ENV_NAMES)[number])), {
      message: `these environment variables cannot be set for a command, because the engine will not honour them and the command would differ from the one asked for: ${PROTECTED_ENV_NAMES.join(', ')}`,
    }),
  mergeStderr: z.boolean().optional(),
  /** A literal here-string, used only when nothing is piped in \u2014 an upstream stage, if
   *  present, always wins over this. */
  stdin: z.string().optional(),
  /** Writes a stream to a file instead of yielding/capturing it \u2014 a relative path resolves
   *  against this call's own `cwd`, matching ExecV3's own redirect convention. Merging stderr
   *  into stdout is `mergeStderr`, not expressed here. */
  redirect: z.object({ stdout: pathSchema.optional(), stderr: pathSchema.optional() }).optional(),
  /** Kills the process after this many milliseconds, same as ExecV3's own `timeout`. */
  timeout: z.number().int().positive().optional(),
  /** Strips ANSI escape sequences from every line before it's yielded or captured. Defaults to
   *  true, matching ExecV3's own default. */
  stripAnsi: z.boolean().optional(),
});

function streamToReadable(source: AsyncIterable<unknown>): Readable {
  return Readable.from(
    (async function* () {
      for await (const value of source) {
        yield `${String(value)}\n`;
      }
    })(),
  );
}

/** A line-splitting sink: buffers chunks, calls `onLine` for each complete line. Shared
 *  between stdout and stderr wiring so both channels apply the same line-framing. A trailing
 *  line with no terminating newline — a real process's last line commonly has none — is never
 *  dispatched via the stream's own `end` event: that races the executor's resolved promise
 *  (order between a stream event and a settled promise isn't guaranteed), so the caller must
 *  call the returned `flush()` once it independently knows the process has actually finished. */
function makeLineSink(onLine: (line: string) => void, bufferBytes: number): { sink: PassThrough; flush: () => void } {
  const sink = new PassThrough({ highWaterMark: bufferBytes });
  let buffer = '';
  sink.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let idx = buffer.indexOf('\n');
    while (idx >= 0) {
      onLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
      idx = buffer.indexOf('\n');
    }
  });
  return {
    sink,
    flush: () => {
      if (buffer.length > 0) {
        onLine(buffer);
        buffer = '';
      }
    },
  };
}

/** The `ExecV3`/`ExecV2` successor tool (see the design doc: both collapse into `Program` \u2014
 *  Orchestrate's own `&&`/`||`/`|`/`;` now does the composing ExecV3 used to do internally).
 *  `stderr` is always captured into the array the caller passed in, or folded into stdout when
 *  `mergeStderr` is set \u2014 matching real `2>&1` / git's own default. Applies the failsafe caps
 *  and the real `PipeConsumerGone` -> SIGPIPE mapping so a short-circuiting consumer honestly
 *  kills the real process, the same as a real shell pipe. Full feature parity with ExecV3:
 *  literal stdin, file redirects, a per-call timeout, and default ANSI stripping. */
/** Substitutes `$NAME` / `${NAME}` from the environment this call will actually run under, so a
 *  variable the provider supplies (an ambient one like `$TMUX_PANE`, or a value an earlier stage
 *  captured) reaches the program as its real value. There is no shell here to do it, so unexpanded
 *  the program receives the literal `$TMUX_PANE`. An unknown name is left as written rather than
 *  blanked, so a genuine literal `$` survives and a typo is visible instead of silently empty. */
function expandVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{(\w+)\}|\$(\w+)/g, (whole, braced: string | undefined, bare: string | undefined) => env[braced ?? bare ?? ''] ?? whole);
}

export function createProgramToolV2(executor: IExecutor, fs: IFileSystem, envProvider: IEnvProvider, bufferBytes: number = PIPE_BUFFER_BYTES) {
  return defineToolV2({
    name: 'Program',
    readsUpstream: true,
    description: 'Spawn one process, bytes in, bytes out. Compose with && / || / | / ; via Orchestrate.',
    // A redirect writes a file, so a call that has one is a write as well as an execution, and both
    // are decided on. Otherwise a path rule could only ever see the working directory, and a rule
    // about writing outside the project would never fire for a command that writes there.
    operations: (input) => (input.redirect?.stdout != null || input.redirect?.stderr != null ? ['fs.exec', 'fs.write'] : ['fs.exec']),
    model: ProgramToolV2Model,
    resolveDefaults: (input) => (input.cwd != null ? input : { ...input, cwd: fs.cwd() }),
    // The command line as the process will receive it, settled before the stage is judged. A rule
    // about `rm -rf` is worth nothing if a `-rf` written as `$FLAG` reaches Policy unresolved and
    // the process resolved anyway.
    settleInput: (input, env) => {
      const resolved = env.buildEnv(input.env);
      return { ...input, args: input.args?.map((arg) => expandVars(arg, resolved)), cwd: input.cwd != null ? expandVars(input.cwd, resolved) : input.cwd };
    },
    run: (input, upstream, stderr, signal, _scope, runEnv): ToolV2Result<string> => {
      const cwd = input.cwd as string;
      const controller = new AbortController();
      // The caller's signal (e.g. QueryRunner's ESC-cancel controller) is linked into this run's
      // own controller — same mechanism as the timeout/cap aborts below, so a real spawned process
      // is actually killed rather than merely having its stream abandoned.
      if (signal != null) {
        if (signal.aborted) {
          controller.abort(signal.reason);
        } else {
          signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
        }
      }
      const clean = input.stripAnsi === false ? (s: string) => s : stripAnsi;
      let finished = false;
      const failure: Error | null = null;
      let exitCode: number | null = null;
      let exitSignal: string | null = null;

      const timer = input.timeout != null ? setTimeout(() => controller.abort(new Error(`timed out after ${input.timeout}ms`)), input.timeout) : undefined;

      function openRedirect(path: string | undefined): Writable | undefined {
        if (path == null) {
          return undefined;
        }
        const file = fs.createWriteStream(resolve(cwd, path), { flags: 'w' });
        file.on('error', () => {
          // Redirect write errors should not crash the run.
        });
        return file;
      }
      const stdoutRedirect = openRedirect(input.redirect?.stdout);
      const stderrRedirect = openRedirect(input.redirect?.stderr);

      // The one place a running process's output sits, and the only thing that bounds it. Nothing
      // reads it until the consumer asks for a line, so it fills, the executor's pipe stops
      // draining the child, and the child waits in its own write — which is all a pipe is.
      const pipe = new PassThrough({ highWaterMark: bufferBytes });
      // A file redirect has its own consumer, so that output is drained as it arrives rather than
      // waiting for a reader who will never come.
      const toFile =
        stdoutRedirect != null
          ? makeLineSink((line) => {
              stdoutRedirect.write(`${clean(line)}\n`);
            }, bufferBytes)
          : undefined;
      if (toFile) {
        pipe.pipe(toFile.sink);
      }

      // Merged stderr is the same stream as far as the caller is concerned, so the executor writes
      // both channels into the one buffer rather than this tool interleaving them by hand.
      const stderrSink = input.mergeStderr
        ? undefined
        : makeLineSink((line) => {
            const cleaned = clean(line);
            if (stderrRedirect) {
              stderrRedirect.write(`${cleaned}\n`);
            } else {
              stderr.push(cleaned);
            }
          }, bufferBytes);

      const stdin = upstream != null ? streamToReadable(upstream) : input.stdin != null ? Readable.from(input.stdin) : undefined;
      // The same provider ExecV3 runs under, so a V2 exec strips ambient credentials exactly as a
      // V1 one does, rather than inheriting the raw process environment. Inside an Orchestrate run
      // the provider handed in is that run's own overlay, so whatever an earlier stage captured is
      // a real environment variable here.
      const env = (runEnv ?? envProvider).buildEnv(input.env);
      // Already settled by `settleInput`, which is what Policy judged: the command runs as decided
      // rather than being rewritten afterwards.
      const cmd: CommandSpec = { program: input.program, args: input.args, cwd, env };
      const runPromise = executor
        .run(cmd, { stdout: pipe, stderr: stderrSink?.sink ?? pipe, stdin, signal: controller.signal })
        .then((status) => {
          exitCode = status.exitCode;
          exitSignal = status.signal;
        })
        .finally(() => {
          if (timer) {
            clearTimeout(timer);
          }
          toFile?.flush();
          stderrSink?.flush();
          finished = true;
          // The writer is gone, so the reader drains what is left and then sees the end, the same
          // way a pipe reports end-of-file once its last write end closes.
          if (!pipe.writableEnded) {
            pipe.end();
          }
        });

      // Reads the buffer only when the caller asks for a line, which is what leaves it full while
      // nobody is reading and therefore what stops the process.
      async function* drain(): Stream<string> {
        try {
          if (toFile) {
            await runPromise;
          } else {
            let partial = '';
            for await (const chunk of pipe) {
              partial += (chunk as Buffer).toString('utf8');
              let idx = partial.indexOf('\n');
              while (idx >= 0) {
                const line = partial.slice(0, idx);
                partial = partial.slice(idx + 1);
                yield clean(line);
                idx = partial.indexOf('\n');
              }
            }
            // A real process's last line commonly has no terminating newline.
            if (partial.length > 0) {
              yield clean(partial);
            }
          }
        } finally {
          // A downstream consumer stopped pulling before the process finished on its own \u2014
          // PipeConsumerGone maps to a real SIGPIPE kill in Executor, the honest signal for
          // "your reader went away", matching `yes | head -1`'s real behaviour. A spawned
          // process with no OS-level pipe consumer never gets this for free otherwise.
          if (!finished) {
            controller.abort(PipeConsumerGone);
          }
          await runPromise.catch(() => {});
        }
        if (failure) {
          throw failure;
        }
      }

      const gen = drain();
      // A bare async generator's .return() is not enough here: per spec (AsyncGeneratorAwaitReturn),
      // return() called while suspended mid-await must wait for THAT SAME pending promise to settle
      // before it can proceed -- and the internal wait above (new Promise(resolve => resolveNext = resolve))
      // has nothing else that ever resolves it, so an unwrapped generator.return() deadlocks forever
      // instead of running the finally block that does the SIGPIPE abort. Wrapping return() to trigger
      // the abort AND resolve that pending promise synchronously, before delegating, is what actually
      // lets the finally block run promptly -- confirmed by reproducing the hang without this wrapper.
      const stream: Stream<string> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        [Symbol.asyncDispose]: async () => {
          await stream.return();
        },
        next: () => gen.next(),
        return: () => {
          if (!finished) {
            controller.abort(PipeConsumerGone);
          }
          return gen.return();
        },
        throw: (e) => gen.throw(e),
      };

      return {
        stdout: stream,
        success: () => exitCode === 0,
        signal: () => exitSignal,
      };
    },
  });
}
