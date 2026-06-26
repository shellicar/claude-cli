import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Executor } from '../src/Executor.js';

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
