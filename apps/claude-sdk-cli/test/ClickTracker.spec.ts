import { describe, expect, it } from 'vitest';
import type { ClickRegion } from '../src/model/ClickRegion.js';
import { ClickTracker } from '../src/model/ClickTracker.js';

// Each call builds a fresh object, so a test that presses and releases "the same"
// region is passing two distinct objects naming one target — the repaint case,
// where the frame the release resolves against is not the frame the press did.
const region = (id: string, text = 'const a = 1;', row = 4): ClickRegion => ({ id, row, startCol: 10, endCol: 12, text });

describe('ClickTracker', () => {
  it('returns the pressed region when the release lands on the same target', () => {
    const expected = region('fence-1');
    const tracker = new ClickTracker();
    tracker.press(expected);
    const actual = tracker.release(region('fence-1'));
    expect(actual).toBe(expected);
  });

  it('returns the pressed region when a repaint moved the target to another row', () => {
    const expected = region('fence-1', 'const a = 1;', 4);
    const tracker = new ClickTracker();
    tracker.press(expected);
    const actual = tracker.release(region('fence-1', 'const a = 1;', 3));
    expect(actual).toBe(expected);
  });

  it('returns null when the release lands on a different target', () => {
    const tracker = new ClickTracker();
    tracker.press(region('fence-1'));
    const actual = tracker.release(region('fence-2', 'const b = 2;'));
    expect(actual).toBeNull();
  });

  it('returns null when the release lands on a different target carrying identical text', () => {
    const tracker = new ClickTracker();
    tracker.press(region('block-1', 'continue'));
    const actual = tracker.release(region('block-2', 'continue'));
    expect(actual).toBeNull();
  });

  it('returns null when the release lands on no target', () => {
    const tracker = new ClickTracker();
    tracker.press(region('fence-1'));
    const actual = tracker.release(null);
    expect(actual).toBeNull();
  });

  it('returns null when a press landed on no target', () => {
    const tracker = new ClickTracker();
    tracker.press(null);
    const actual = tracker.release(region('fence-1'));
    expect(actual).toBeNull();
  });

  it('returns null for a release with no press before it', () => {
    const tracker = new ClickTracker();
    const actual = tracker.release(region('fence-1'));
    expect(actual).toBeNull();
  });

  it('returns null for a second release once the first consumed the press', () => {
    const tracker = new ClickTracker();
    tracker.press(region('fence-1'));
    tracker.release(region('fence-1'));
    const actual = tracker.release(region('fence-1'));
    expect(actual).toBeNull();
  });

  it('matches the most recent press when two arrive without a release', () => {
    const expected = region('fence-2', 'const b = 2;');
    const tracker = new ClickTracker();
    tracker.press(region('fence-1'));
    tracker.press(expected);
    const actual = tracker.release(region('fence-2', 'const b = 2;'));
    expect(actual).toBe(expected);
  });
});
