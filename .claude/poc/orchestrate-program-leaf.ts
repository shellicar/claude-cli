// Scratch POC, step 6 — the real Program leaf, now against the stdout/stderr/success contract
// from orchestrate-stderr.ts. Fixes the real bug found comparing the two: stderr was previously
// left unwired, which Executor treats as "drain to nothing" — anything the process wrote to
// stderr was silently discarded. Also adds merge_stderr, matching real `2>&1` / git's own default.

import { PassThrough, Readable } from 'node:stream';
import { Executor, PipeConsumerGone } from '../../packages/exec-core/dist/esm/index.js';
import type { CommandSpec } from '../../packages/exec-core/dist/esm/index.js';

export type Stream<T> = AsyncGenerator<T, void, unknown>;

export type FsOperation = 'fs.list' | 'fs.read' | 'fs.write' | 'fs.delete' | 'fs.exec';

export type LeafResult<TOut> = {
  stdout: Stream<TOut>;
  success: () => boolean;
};

export type Leaf<TIn, TOut> = {
  name: string;
  operation: 'none' | FsOperation;
  showStderr?: boolean;
  run: (input: TIn, upstream: Stream<unknown> | AsyncIterable<unknown> | undefined, stderr: string[]) => LeafResult<TOut>;
};

const MAX_LINES = 10_000;
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

class FailsafeTerminated extends Error {
  constructor(reason: string) {
    super(`Program leaf hard-terminated: ${reason}`);
  }
}

function streamToReadable(source: AsyncIterable<unknown> | undefined): Readable | undefined {
  if (source == null) return undefined;
  return Readable.from(
    (async function* () {
      for await (const value of source) yield `${String(value)}\n`;
    })(),
  );
}

// A line-splitting sink: buffers chunks, calls `onLine` for each complete line. Shared between
// stdout and stderr wiring so both channels apply the same line-framing.
function makeLineSink(onLine: (line: string) => void, onByte: (n: number) => void): PassThrough {
  const sink = new PassThrough();
  let buffer = '';
  sink.on('data', (chunk: Buffer) => {
    onByte(chunk.length);
    buffer += chunk.toString('utf8');
    let idx: number;
    // biome-ignore lint: scratch POC
    while ((idx = buffer.indexOf('\n')) >= 0) {
      onLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  });
  return sink;
}

export function makeProgramLeaf(spec: Omit<CommandSpec, 'env'> & { env?: NodeJS.ProcessEnv; mergeStderr?: boolean }): Leaf<Record<string, never>, string> {
  return {
    name: `Program(${spec.program})`,
    operation: 'fs.exec',
    run: (_input, upstream, stderr) => {
      const executor = new Executor();
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
          failure = new FailsafeTerminated(`exceeded ${MAX_BYTES} bytes of output`);
          controller.abort(failure);
          return false;
        }
        if (lineCount > MAX_LINES) {
          failure = new FailsafeTerminated(`exceeded ${MAX_LINES} lines of output`);
          controller.abort(failure);
          return false;
        }
        return true;
      };

      const stdoutSink = makeLineSink(
        (line) => {
          lineCount++;
          if (!checkCaps()) return;
          queue.push(line);
          wake();
        },
        (n) => {
          byteCount += n;
        },
      );

      // stderr always captured — the leaf never decides whether it's shown, only that it's
      // recorded. mergeStderr folds it into the same queue as stdout (2>&1 / git's default);
      // otherwise it goes into the `stderr` array the caller passed in.
      const stderrSink = makeLineSink(
        (line) => {
          if (spec.mergeStderr) {
            lineCount++;
            if (!checkCaps()) return;
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

      const runPromise = executor
        .run({ program: spec.program, args: spec.args, cwd: spec.cwd, env: spec.env ?? process.env }, { stdout: stdoutSink, stderr: stderrSink, stdin: streamToReadable(upstream), signal: controller.signal })
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
            while (queue.length > 0) yield queue.shift() as string;
            if (finished && queue.length === 0) break;
          }
        } finally {
          if (!finished) controller.abort(PipeConsumerGone);
          await runPromise.catch(() => {});
        }
        if (failure) throw failure;
      }

      return {
        stdout: drain(),
        success: () => exitCode === 0,
      };
    },
  };
}

async function mainProgramLeafDemo() {
  console.log('=== Run A: separate stderr — stdout and stderr land in different channels ===');
  {
    const leaf = makeProgramLeaf({ program: 'sh', args: ['-c', 'echo out-line; echo err-line 1>&2'], cwd: process.cwd() });
    const stderr: string[] = [];
    const { stdout, success } = leaf.run({}, undefined, stderr);
    const out: string[] = [];
    for await (const line of stdout) out.push(line);
    console.log('stdout:', out);
    console.log('stderr:', stderr);
    console.log('success:', success());
    console.log(out.length === 1 && stderr.length === 1 ? 'PASS: stdout and stderr correctly separated' : 'FAIL: channels mixed or stderr lost');
  }

  console.log("\n=== Run B: mergeStderr: true — stderr folds into stdout, in order ===");
  {
    const leaf = makeProgramLeaf({ program: 'sh', args: ['-c', 'echo out-line; echo err-line 1>&2'], cwd: process.cwd(), mergeStderr: true });
    const stderr: string[] = [];
    const { stdout, success } = leaf.run({}, undefined, stderr);
    const out: string[] = [];
    for await (const line of stdout) out.push(line);
    console.log('stdout (merged):', out);
    console.log('stderr (should be empty, everything went to stdout):', stderr);
    console.log('success:', success());
    console.log(stderr.length === 0 && out.length === 2 ? 'PASS: stderr merged into stdout' : 'FAIL: merge did not happen correctly');
  }

  console.log('\n=== Run C: failure — non-zero exit, success() is false, stderr still captured ===');
  {
    const leaf = makeProgramLeaf({ program: 'sh', args: ['-c', 'echo bad 1>&2; exit 1'], cwd: process.cwd() });
    const stderr: string[] = [];
    const { stdout, success } = leaf.run({}, undefined, stderr);
    const out: string[] = [];
    for await (const line of stdout) out.push(line);
    console.log('stdout:', out);
    console.log('stderr:', stderr);
    console.log('success:', success());
    console.log(!success() && stderr.length === 1 ? 'PASS: failure correctly reported, stderr captured' : 'FAIL');
  }
}

async function regressionChecks() {
  console.log('\n=== Regression: failsafe still fires on an uncapped runaway producer ===');
  {
    const leaf = makeProgramLeaf({ program: 'yes', cwd: process.cwd() });
    const stderr: string[] = [];
    const { stdout } = leaf.run({}, undefined, stderr);
    let count = 0;
    try {
      for await (const _line of stdout) count++;
      console.log(`FAIL: produced only ${count} lines and stopped on its own`);
    } catch (err) {
      console.log(`PASS: failsafe fired after ${count} lines —`, (err as Error).message);
    }
  }

  console.log('\n=== Regression: short-circuit still kills the real process (SIGPIPE) ===');
  {
    const leaf = makeProgramLeaf({ program: 'yes', args: ['line'], cwd: process.cwd() });
    const stderr: string[] = [];
    const { stdout } = leaf.run({}, undefined, stderr);
    const out: string[] = [];
    for await (const line of stdout) {
      out.push(line);
      if (out.length >= 3) {
        await stdout.return(undefined);
        break;
      }
    }
    console.log(out.length === 3 ? 'PASS: exactly 3 lines, short-circuited' : `FAIL: got ${out.length} lines`);
  }
}

if (process.argv[1]?.endsWith('orchestrate-program-leaf.ts')) {
  mainProgramLeafDemo().then(regressionChecks);
}
