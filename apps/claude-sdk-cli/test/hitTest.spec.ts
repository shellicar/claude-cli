import { describe, expect, it } from 'vitest';
import { type ClickRegion, hitTest } from '../src/model/ClickRegion.js';

const region = (overrides: Partial<ClickRegion> = {}): ClickRegion => ({ row: 4, startCol: 10, endCol: 12, text: 'const a = 1;', ...overrides });

describe('hitTest', () => {
  it('finds the region a point falls inside', () => {
    const expected = region();
    const actual = hitTest([expected], 11, 4);
    expect(actual).toBe(expected);
  });

  it('finds a region at its first column', () => {
    const expected = region();
    const actual = hitTest([expected], 10, 4);
    expect(actual).toBe(expected);
  });

  it('finds a region at its last column', () => {
    const expected = region();
    const actual = hitTest([expected], 12, 4);
    expect(actual).toBe(expected);
  });

  it('returns null for a column before the region', () => {
    const actual = hitTest([region()], 9, 4);
    expect(actual).toBeNull();
  });

  it('returns null for a column past the region', () => {
    const actual = hitTest([region()], 13, 4);
    expect(actual).toBeNull();
  });

  it('returns null for the right column on the wrong row', () => {
    const actual = hitTest([region()], 11, 5);
    expect(actual).toBeNull();
  });

  it('returns null when there are no regions', () => {
    const actual = hitTest([], 11, 4);
    expect(actual).toBeNull();
  });

  it('picks the region on the clicked row when several rows carry one', () => {
    const expected = region({ row: 7, text: 'const b = 2;' });
    const actual = hitTest([region(), expected], 11, 7);
    expect(actual).toBe(expected);
  });

  it('picks the region in the clicked column span when a row carries several', () => {
    const expected = region({ startCol: 20, endCol: 22, text: 'const b = 2;' });
    const actual = hitTest([region(), expected], 21, 4);
    expect(actual).toBe(expected);
  });
});
