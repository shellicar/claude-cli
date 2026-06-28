import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { TimeoutSleepProvider } from '../src/providers/TimeoutSleepProvider';

describe('TimeoutSleepProvider', () => {
  it('removes its abort listener after a sleep completes by timeout', async () => {
    const provider = new TimeoutSleepProvider();
    const controller = new AbortController();

    await provider.sleep(0, controller.signal);

    const expected = 0;
    const actual = getEventListeners(controller.signal, 'abort').length;
    expect(actual).toBe(expected);
  });

  it('does not accumulate abort listeners across many sleeps on one reused signal', async () => {
    const provider = new TimeoutSleepProvider();
    const controller = new AbortController();

    for (let i = 0; i < 20; i++) {
      await provider.sleep(0, controller.signal);
    }

    const expected = 0;
    const actual = getEventListeners(controller.signal, 'abort').length;
    expect(actual).toBe(expected);
  });

  it('removes its abort listener after a sleep is aborted', async () => {
    const provider = new TimeoutSleepProvider();
    const controller = new AbortController();

    const sleeping = provider.sleep(10_000, controller.signal);
    controller.abort();
    await sleeping;

    const expected = 0;
    const actual = getEventListeners(controller.signal, 'abort').length;
    expect(actual).toBe(expected);
  });

  it('resolves the sleep when the signal aborts before the delay elapses', async () => {
    const provider = new TimeoutSleepProvider();
    const controller = new AbortController();

    const sleeping = provider.sleep(10_000, controller.signal);
    controller.abort();

    const expected = undefined;
    const actual = await sleeping;
    expect(actual).toBe(expected);
  });
});
