import { describe, expect, it } from 'vitest';
import { execSignal } from '../src/exec-shared';

// Pure mechanism tests — no spawn, no real fs. The parent-only cases are instant
// (AbortController.abort() is synchronous). The timeout cases need a real, tiny wait:
// AbortSignal.timeout uses Node's native internal timer, not the JS setTimeout vitest's
// fake timers intercept, so vi.useFakeTimers() never advances it — a real sub-50ms delay
// is the only way to observe it fire, still with no spawn and no real fs involved.

describe('execSignal — no parent, no timeout', () => {
  it('returns undefined', () => {
    const expected = undefined;
    const actual = execSignal(undefined, undefined);
    expect(actual).toBe(expected);
  });
});

describe('execSignal — parent only', () => {
  it('returns the parent signal itself, unwrapped', () => {
    const controller = new AbortController();
    const expected = controller.signal;
    const actual = execSignal(controller.signal, undefined);
    expect(actual).toBe(expected);
  });

  it('reflects the parent aborting', () => {
    const controller = new AbortController();
    const signal = execSignal(controller.signal, undefined);
    controller.abort();

    const expected = true;
    const actual = signal?.aborted;
    expect(actual).toBe(expected);
  });
});

describe('execSignal — timeout only', () => {
  it('is not aborted immediately', () => {
    const signal = execSignal(undefined, 50);

    const expected = false;
    const actual = signal?.aborted;
    expect(actual).toBe(expected);
  });

  it('aborts once the timeout elapses', async () => {
    const signal = execSignal(undefined, 20);
    await new Promise((resolve) => setTimeout(resolve, 40));

    const expected = true;
    const actual = signal?.aborted;
    expect(actual).toBe(expected);
  });
});

describe('execSignal — parent and timeout combined', () => {
  it('aborts when the parent aborts, before the timeout elapses', () => {
    const controller = new AbortController();
    const signal = execSignal(controller.signal, 50);
    controller.abort();

    const expected = true;
    const actual = signal?.aborted;
    expect(actual).toBe(expected);
  });

  it('aborts when the timeout elapses, without the parent aborting', async () => {
    const controller = new AbortController();
    const signal = execSignal(controller.signal, 20);
    await new Promise((resolve) => setTimeout(resolve, 40));

    const expected = true;
    const actual = signal?.aborted;
    expect(actual).toBe(expected);
  });

  it('is not aborted immediately, before either fires', () => {
    const controller = new AbortController();
    const signal = execSignal(controller.signal, 50);

    const expected = false;
    const actual = signal?.aborted;
    expect(actual).toBe(expected);
  });
});
