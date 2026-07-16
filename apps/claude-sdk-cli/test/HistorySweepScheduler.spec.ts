import { IHistorySweeper } from '@shellicar/claude-core/history/interfaces';
import type { HistorySweepResult } from '@shellicar/claude-core/history/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistorySweepScheduler } from '../src/persistence/HistorySweepScheduler.js';

const silentLogger = { error: () => {} };

class CountingSweeper extends IHistorySweeper {
  public calls = 0;
  public sweep(): HistorySweepResult {
    this.calls++;
    return { ran: true, scanned: 0, collapsed: 0 };
  }
}

class ThrowingSweeper extends IHistorySweeper {
  public sweep(): HistorySweepResult {
    throw new Error('boom');
  }
}

describe('HistorySweepScheduler — jitter', () => {
  it('waits the minimum delay when the random source is at its floor', () => {
    const scheduler = new HistorySweepScheduler(new CountingSweeper(), silentLogger, { minDelayMs: 1000, maxDelayMs: 5000, random: () => 0 });
    const expected = 1000;

    const actual = scheduler.nextDelayMs();

    expect(actual).toBe(expected);
  });

  it('stays below the maximum delay when the random source is near its ceiling', () => {
    const scheduler = new HistorySweepScheduler(new CountingSweeper(), silentLogger, { minDelayMs: 1000, maxDelayMs: 5000, random: () => 0.999 });

    const actual = scheduler.nextDelayMs();

    expect(actual).toBeLessThan(5000);
  });
});

describe('HistorySweepScheduler — loop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a pass after the delay elapses', () => {
    const sweeper = new CountingSweeper();
    const scheduler = new HistorySweepScheduler(sweeper, silentLogger, { minDelayMs: 1000, maxDelayMs: 1000 });
    scheduler.start();
    vi.advanceTimersByTime(1000);
    scheduler.stop();

    const expected = 1;
    const actual = sweeper.calls;

    expect(actual).toBe(expected);
  });

  it('does not run a pass once stopped', () => {
    const sweeper = new CountingSweeper();
    const scheduler = new HistorySweepScheduler(sweeper, silentLogger, { minDelayMs: 1000, maxDelayMs: 1000 });
    scheduler.start();
    scheduler.stop();
    vi.advanceTimersByTime(5000);

    const expected = 0;
    const actual = sweeper.calls;

    expect(actual).toBe(expected);
  });

  it('arms the next pass after one completes', () => {
    const sweeper = new CountingSweeper();
    const scheduler = new HistorySweepScheduler(sweeper, silentLogger, { minDelayMs: 1000, maxDelayMs: 1000 });
    scheduler.start();
    vi.advanceTimersByTime(3000);
    scheduler.stop();

    const expected = 3;
    const actual = sweeper.calls;

    expect(actual).toBe(expected);
  });

  it('swallows a failed pass and logs it', () => {
    const error = vi.fn();
    const scheduler = new HistorySweepScheduler(new ThrowingSweeper(), { error }, { minDelayMs: 1000, maxDelayMs: 1000 });
    scheduler.start();
    vi.advanceTimersByTime(1000);
    scheduler.stop();

    const expected = 1;
    const actual = error.mock.calls.length;

    expect(actual).toBe(expected);
  });
});
