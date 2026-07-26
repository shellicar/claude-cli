import { resolve } from 'node:path';
import { PassThrough, Readable, type Writable } from 'node:stream';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { CommandSpec, IExecutor } from '@shellicar/exec-core';
import { PipeConsumerGone } from '@shellicar/exec-core';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { stripAnsi } from '../../Exec/stripAnsi.js';
import { defineToolV2 } from '../defineToolV2.js';

// A tool that streams unbounded output (nothing downstream capping it) must hard-terminate
// rather than run forever or grow memory without bound. Deliberately conservative.
const MAX_LINES = 10_000;
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export class ProgramFailsafeTerminated extends Error {
  public constructor(reason: string) {
    super(`Program tool hard-terminated: ${reason}`);
  }
}

export const ProgramToolV2Model = z.object({
  program: z.string().describe('The program to execute. Supports ~ and $VAR expansion. Must be on $PATH or an absolute path.'),
  args: z.array(z.string()).optional(),
  cwd: z.string().describe('Working directory for this command.'),
  env: z.record(z.string(), z.string()).optional(),
  mergeStderr: z.boolean().optional(),
  /** A literal here-string, used only when nothing is piped in \u2014 an upstream stage, if
   *  present, always wins over this. */
  stdin: z.string().optional(),
  /** Writes a stream to a file instead of yielding/capturing it \u2014 a relative path resolves
   *  against this call's own `cwd`, matching ExecV3's own redirect convention. Merging stderr
   *  into stdout is `mergeStderr`, not expressed here. */
  redirect: z.object({ stdout: z.string().optional(), stderr: z.string().optional() }).optional(),
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
function makeLineSink(onLine: (line: string) => void, onByte: (n: number) => void): { sink: PassThrough; flush: () => void } {
  const sink = new PassThrough();
  let buffer = '';
  sink.on('data', (chunk: Buffer) => {
    onByte(chunk.length);
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
export function createProgramToolV2(executor: IExecutor, fs: IFileSystem) {
  return defineToolV2({
    name: 'Program',
    description: 'Spawn one process, bytes in, bytes out. Compose with && / || / | / ; via Orchestrate.',
    operation: 'fs.exec',
    model: ProgramToolV2Model,
    run: (input, upstream, stderr): ToolV2Result<string> => {
      const controller = new AbortController();
      const clean = input.stripAnsi === false ? (s: string) => s : stripAnsi;
      let lineCount = 0;
      let byteCount = 0;
      const queue: string[] = [];
      let resolveNext: (() => void) | null = null;
      let finished = false;
      let failure: Error | null = null;
      let exitCode: number | null = null;

      const timer = input.timeout != null ? setTimeout(() => controller.abort(new Error(`timed out after ${input.timeout}ms`)), input.timeout) : undefined;

      const wake = () => {
        resolveNext?.();
        resolveNext = null;
      };

      const checkCaps = (): boolean => {
        if (byteCount > MAX_BYTES) {
          failure = new ProgramFailsafeTerminated(`exceeded ${MAX_BYTES} bytes of output`);
          controller.abort(failure);
          return false;
        }
        if (lineCount > MAX_LINES) {
          failure = new ProgramFailsafeTerminated(`exceeded ${MAX_LINES} lines of output`);
          controller.abort(failure);
          return false;
        }
        return true;
      };

      function openRedirect(path: string | undefined): Writable | undefined {
        if (path == null) {
          return undefined;
        }
        const file = fs.createWriteStream(resolve(input.cwd, path), { flags: 'w' });
        file.on('error', () => {
          // Redirect write errors should not crash the run.
        });
        return file;
      }
      const stdoutRedirect = openRedirect(input.redirect?.stdout);
      const stderrRedirect = openRedirect(input.redirect?.stderr);

      const stdoutSink = makeLineSink(
        (line) => {
          lineCount++;
          if (!checkCaps()) {
            return;
          }
          const cleaned = clean(line);
          if (stdoutRedirect) {
            stdoutRedirect.write(`${cleaned}\n`);
          } else {
            queue.push(cleaned);
          }
          wake();
        },
        (n) => {
          byteCount += n;
        },
      );

      const stderrSink = makeLineSink(
        (line) => {
          const cleaned = clean(line);
          if (input.mergeStderr) {
            lineCount++;
            if (!checkCaps()) {
              return;
            }
            if (stdoutRedirect) {
              stdoutRedirect.write(`${cleaned}\n`);
            } else {
              queue.push(cleaned);
            }
          } else if (stderrRedirect) {
            stderrRedirect.write(`${cleaned}\n`);
          } else {
            stderr.push(cleaned);
          }
          wake();
        },
        (n) => {
          byteCount += n;
        },
      );

      const stdin = upstream != null ? streamToReadable(upstream) : input.stdin != null ? Readable.from(input.stdin) : undefined;
      const cmd: CommandSpec = { program: input.program, args: input.args, cwd: input.cwd, env: input.env ?? process.env };
      const runPromise = executor
        .run(cmd, { stdout: stdoutSink.sink, stderr: stderrSink.sink, stdin, signal: controller.signal })
        .then((status) => {
          exitCode = status.exitCode;
        })
        .finally(() => {
          if (timer) {
            clearTimeout(timer);
          }
          stdoutSink.flush();
          stderrSink.flush();
          finished = true;
          wake();
        });

      async function* drain(): Stream<string> {
        try {
          while (true) {
            if (queue.length === 0 && !finished) {
              await new Promise<void>((resolve) => {
                resolveNext = resolve;
              });
            }
            while (queue.length > 0) {
              yield queue.shift() as string;
            }
            if (finished && queue.length === 0) {
              break;
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

      return {
        stdout: drain(),
        success: () => exitCode === 0,
      };
    },
  });
}
