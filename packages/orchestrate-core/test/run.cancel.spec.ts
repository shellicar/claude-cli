import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { FakeApprover, FakeSleep, FakeTool, stage } from './fakes.js';

// Cancelling is the run being told to stop, which is the same thing a timeout does and the same
// thing a reader leaving does. A tool has one way of being told.

function options(signal: AbortSignal) {
  return { decide: new FakeApprover().decide, sleep: new FakeSleep().sleep, hold: 64 * 1024, ahead: 4096, signal };
}

const never = () => new Promise<void>(() => {});

describe('a run that is cancelled while a stage is running', () => {
  it('stops that stage', async () => {
    const cancel = new AbortController();
    const producer = new FakeTool('Find', { writes: ['one\n'], waitsFor: never() });

    const running = run([stage(producer)], options(cancel.signal));
    cancel.abort();
    await running;

    const expected = true;
    const actual = producer.stopped;
    expect(actual).toBe(expected);
  });

  it('reports it as cancelled', async () => {
    const cancel = new AbortController();
    const producer = new FakeTool('Find', { writes: ['one\n'], waitsFor: never() });

    const running = run([stage(producer)], options(cancel.signal));
    cancel.abort();
    const { stages } = await running;

    const expected = 'cancelled';
    const actual = stages[0]?.ended.kind;
    expect(actual).toBe(expected);
  });

  it('does not start the stage after it', async () => {
    const cancel = new AbortController();
    const after = new FakeTool('Report');
    const producer = new FakeTool('Find', { writes: ['one\n'], waitsFor: never() });

    const running = run([stage(producer), stage(after)], options(cancel.signal));
    cancel.abort();
    await running;

    const expected = false;
    const actual = after.ran;
    expect(actual).toBe(expected);
  });

  it('hands back what was produced before it was cancelled', async () => {
    const cancel = new AbortController();
    const producer = new FakeTool('Find', { writes: ['one\n'], waitsFor: never() });

    const running = run([stage(producer)], options(cancel.signal));
    await Promise.resolve();
    cancel.abort();
    const { output } = await running;

    const expected = 'one\n';
    const actual = output.toString('utf8');
    expect(actual).toBe(expected);
  });
});

describe('a run cancelled before it starts', () => {
  it('runs nothing', async () => {
    const cancel = new AbortController();
    cancel.abort();
    const tool = new FakeTool('Find', { writes: ['one\n'] });

    await run([stage(tool)], options(cancel.signal));

    const expected = false;
    const actual = tool.ran;
    expect(actual).toBe(expected);
  });

  it('reports every stage as cancelled', async () => {
    const cancel = new AbortController();
    cancel.abort();

    const { stages } = await run([stage(new FakeTool('Find')), stage(new FakeTool('Report'))], options(cancel.signal));

    const expected = ['cancelled', 'cancelled'];
    const actual = stages.map((report) => report.ended.kind);
    expect(actual).toEqual(expected);
  });
});
