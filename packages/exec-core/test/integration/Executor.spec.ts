import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Executor } from '../../src/Executor.js';

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

  // The kernel, not this package, is what stops the producer: closing the read end is the
  // whole mechanism, so this goes red if the fd handoff is ever routed back through the parent.
  it('kills a producer with SIGPIPE when its consumer exits early', async () => {
    using executor = new Executor();
    const terminal = collector();

    const [producer] = await Promise.all(executor.runPipeline([{ cmd: spec('yes') }, { cmd: spec('head', ['-n', '1']), stdout: terminal.sink }]));

    const expected = 'SIGPIPE';
    const actual = producer.signal;
    expect(actual).toBe(expected);
  });
});
