import { PassThrough, Readable } from 'node:stream';
import type { CommandSpec, IExecutor } from '@shellicar/exec-core';
import { PipeConsumerGone } from '@shellicar/exec-core';
import type { Leaf, LeafResult, Stream } from '@shellicar/orchestrate-core';

// A leaf that streams unbounded output (nothing downstream capping it) must hard-terminate
// rather than run forever or grow memory without bound. Deliberately conservative.
const MAX_LINES = 10_000;
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export class ProgramFailsafeTerminated extends Error {
  public constructor(reason: string) {
    super(`Program leaf hard-terminated: ${reason}`);
  }
}

export type ProgramLeafInput = {
  program: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  mergeStderr?: boolean;
};

function streamToReadable(source: AsyncIterable<unknown> | undefined): Readable | undefined {
  if (source == null) {
    return undefined;
  }
  return Readable.from(
    (async function* () {
      for await (const value of source) {
        yield `${String(value)}\n`;
      }
    })(),
  );
}

/** A line-splitting sink: buffers chunks, calls `onLine` for each complete line. Shared
 *  between stdout and stderr wiring so both channels apply the same line-framing. */
function makeLineSink(onLine: (line: string) => void, onByte: (n: number) => void): PassThrough {
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
  return sink;
}

/** The `ExecV3`/`ExecV2` successor leaf (see the design doc: both collapse into `Program` —
 *  Orchestrate's own `&&`/`||`/`;`/`|` now does the composing ExecV3 used to do internally).
 *  `stderr` is always captured (never dropped, unlike the version of this that shipped with
 *  the original POC before its own bug was caught) into the array the caller passed in, or
 *  folded into stdout when `mergeStderr` is set — matching real `2>&1` / git's own default.
 *  Applies the failsafe caps and the real `PipeConsumerGone` -> SIGPIPE mapping so a
 *  short-circuiting consumer honestly kills the real process, the same as a real shell pipe. */
export function createProgramLeaf(executor: IExecutor): Leaf<ProgramLeafInput, string> {
  return {
    name: 'Program',
    operation: 'fs.exec',
    run: (input, upstream, stderr): LeafResult<string> => {
      const controller = new AbortController();
      let lineCount = 0;
      let byteCount = 0;
      const queue: string[] = [];
      let resolveNext: (() => void) | null = null;
      let finished = false;
      let failure: Error | null = null;
      let exitCode: number | null = null;

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

      const stdoutSink = makeLineSink(
        (line) => {
          lineCount++;
          if (!checkCaps()) {
            return;
          }
          queue.push(line);
          wake();
        },
        (n) => {
          byteCount += n;
        },
      );

      const stderrSink = makeLineSink(
        (line) => {
          if (input.mergeStderr) {
            lineCount++;
            if (!checkCaps()) {
              return;
            }
            queue.push(line);
          } else {
            stderr.push(line);
          }
          wake();
        },
        (n) => {
          byteCount += n;
        },
      );

      const cmd: CommandSpec = { program: input.program, args: input.args, cwd: input.cwd, env: input.env ?? process.env };
      const runPromise = executor
        .run(cmd, { stdout: stdoutSink, stderr: stderrSink, stdin: streamToReadable(upstream), signal: controller.signal })
        .then((status) => {
          exitCode = status.exitCode;
        })
        .finally(() => {
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
          // A downstream consumer stopped pulling before the process finished on its own —
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
  };
}
