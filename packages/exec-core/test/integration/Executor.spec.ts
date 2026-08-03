import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Executor } from '../../src/Executor.js';
import { fromStream } from '../../src/fromStream.js';

describe('Executor.run output-sink flush', () => {
  // Ordering contract: run must not resolve until its output sinks have finished
  // flushing. A caller that reads a redirect file the moment run resolves would
  // otherwise race the OS flush and see partial/empty content. The sink here
  // delays its own _final, so 'finish' lands well after end() is called; if run
  // resolves before then, `finished` is still false. No real file is read — the
  // assertion is purely the order of two events.
  it('resolves only after the output sink has finished', async () => {
    using executor = new Executor();
    let finished = false;
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
      final(callback) {
        setTimeout(callback, 50);
      },
    });
    sink.on('finish', () => {
      finished = true;
    });

    await executor.run({ program: 'echo', args: ['hi'], cwd: process.cwd(), env: process.env }, { stdout: sink });

    const expected = true;
    const actual = finished;
    expect(actual).toBe(expected);
  });
});

describe('Executor.run already-aborted signal', () => {
  // A signal that is already aborted when run is called must prevent the spawn
  // outright. addEventListener('abort') never fires for an already-aborted
  // signal, so without a guard the child spawns and runs anyway — defeating
  // ESC-cancel for chained commands that inherit the aborted signal.
  it('does not spawn when the signal is already aborted', async () => {
    using executor = new Executor();
    const controller = new AbortController();
    controller.abort();
    let captured = '';
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        captured += chunk.toString();
        callback();
      },
    });

    await executor.run({ program: 'echo', args: ['hi'], cwd: process.cwd(), env: process.env }, { stdout: sink, signal: controller.signal });

    const expected = '';
    const actual = captured;
    expect(actual).toBe(expected);
  });
});

describe('Executor.runPipeline', () => {
  const spec = (program: string, args: string[] = []) => ({ program, args, cwd: process.cwd(), env: process.env });

  const collector = (): { sink: Writable; read: () => string } => {
    let captured = '';
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        captured += chunk.toString();
        callback();
      },
    });
    return { sink, read: () => captured };
  };

  it('carries a stage\u2019s stdout into the next stage', async () => {
    using executor = new Executor();
    const terminal = collector();

    await Promise.all(executor.runPipeline([{ cmd: spec('echo', ['piped']) }, { cmd: spec('cat'), stdout: terminal.sink }]));

    const expected = 'piped\n';
    const actual = terminal.read();
    expect(actual).toBe(expected);
  });

  // The sink-closing contract holds for every sink a stage was given, not only the ones its
  // output happens to reach. A merged stage sends its child's stderr to stdout, so nothing is
  // ever written to the stderr sink, and it must still be ended: a caller draining that sink
  // to a string waits on an end that would otherwise never come, and never learns the stage
  // finished at all.
  it('ends a merged stage’s stderr sink, which its output never reaches', async () => {
    using executor = new Executor();
    const terminal = collector();
    const unusedStderr = new PassThrough();

    // Draining the sink is both how a caller uses it and how this test observes it: the read
    // completes only if the sink was ended. The bound turns the failure into a value, since an
    // unended sink leaves the read pending rather than rejecting.
    const runs = executor.runPipeline([{ cmd: spec('echo', ['hi']), stdout: terminal.sink, stderr: unusedStderr, mergeStderr: true }]);
    const drained = Promise.all([...runs, fromStream(unusedStderr)]).then(() => 'drained' as const);
    const bound = new Promise<'pending'>((resolve) => {
      setTimeout(() => resolve('pending'), 2000);
    });

    const expected = 'drained';
    const actual = await Promise.race([drained, bound]);
    expect(actual).toBe(expected);
  });

  // Nothing the executor waits for should be something the caller has to do first. A capture
  // is a duplex: the executor writes one end and the caller reads the other, so waiting for it
  // to finish is waiting for the caller, who is waiting for the executor. A caller that drains
  // late, slowly, or not at all is then a hang rather than a mistake with a consequence.
  it('settles even when the caller never drains a sink it was given', async () => {
    using executor = new Executor();
    const neverRead = new PassThrough();

    const settled = Promise.all(executor.runPipeline([{ cmd: spec('echo', ['hi']), stdout: neverRead }])).then(() => 'settled' as const);
    const bound = new Promise<'stalled'>((resolve) => {
      setTimeout(() => resolve('stalled'), 2000);
    });

    const expected = 'settled';
    const actual = await Promise.race([settled, bound]);
    expect(actual).toBe(expected);
  });

  // Both invariants below are ones run() already guarantees, pinned here for a single stage
  // because that is the arity whose route through the executor is the least obvious and the
  // most used: every plain command, and every link of an && chain, is a pipeline of one.
  it('resolves a single stage only after its output sink has finished', async () => {
    using executor = new Executor();
    let finished = false;
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
      final(callback) {
        setTimeout(callback, 50);
      },
    });
    sink.on('finish', () => {
      finished = true;
    });

    await Promise.all(executor.runPipeline([{ cmd: spec('echo', ['hi']), stdout: sink }]));

    const expected = true;
    const actual = finished;
    expect(actual).toBe(expected);
  });

  it('spawns nothing for a single stage when the signal is already aborted', async () => {
    using executor = new Executor();
    const controller = new AbortController();
    controller.abort();
    const terminal = collector();

    await Promise.all(executor.runPipeline([{ cmd: spec('echo', ['hi']), stdout: terminal.sink }], { signal: controller.signal }));

    const expected = '';
    const actual = terminal.read();
    expect(actual).toBe(expected);
  });

  // Same ordering contract as run(): a caller reading a redirect file the moment the promise
  // resolves must not race the flush.
  it('resolves a stage only after its output sink has finished', async () => {
    using executor = new Executor();
    let finished = false;
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
      final(callback) {
        setTimeout(callback, 50);
      },
    });
    sink.on('finish', () => {
      finished = true;
    });

    const runs = executor.runPipeline([{ cmd: spec('echo', ['hi']) }, { cmd: spec('cat'), stdout: sink }]);
    await runs[runs.length - 1];

    const expected = true;
    const actual = finished;
    expect(actual).toBe(expected);
  });

  it('spawns nothing when the signal is already aborted', async () => {
    using executor = new Executor();
    const controller = new AbortController();
    controller.abort();
    const terminal = collector();

    await Promise.all(executor.runPipeline([{ cmd: spec('echo', ['hi']) }, { cmd: spec('cat'), stdout: terminal.sink }], { signal: controller.signal }));

    const expected = '';
    const actual = terminal.read();
    expect(actual).toBe(expected);
  });

  // The kernel, not this package, is what stops the producer: closing the read end is the whole
  // mechanism, so an endless producer settling at all is the proof, and this goes red if the fd
  // handoff is ever routed back through the parent. What it does not assert is how the death
  // reports. Node's stdio is a socketpair, so a consumer exiting with unread bytes left makes the
  // kernel reset the connection and the producer's write fails with ECONNRESET, where a clean
  // close raises SIGPIPE. Measured over 40 rounds: every time SIGPIPE on macOS, roughly one in
  // three on Linux. Only 'stopped, and did not succeed' holds on both.
  it('stops a producer when its consumer exits early', async () => {
    using executor = new Executor();
    const terminal = collector();

    const [producer] = await Promise.all(executor.runPipeline([{ cmd: spec('yes') }, { cmd: spec('head', ['-n', '1']), stdout: terminal.sink }]));

    const expected = true;
    const actual = producer.exitCode !== 0;
    expect(actual).toBe(expected);
  });
});
