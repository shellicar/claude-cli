import { Viewport } from '@shellicar/claude-core/viewport';
import { describe, expect, it } from 'vitest';

describe('Viewport', () => {
  it('buffer shorter than screen: returns screenRows entries (content + padding)', () => {
    const vp = new Viewport();
    const buffer = ['a', 'b', 'c', 'd', 'e'];
    const result = vp.resolve(buffer, 10, 0, 0);
    expect(result.rows.length).toBe(10);
    expect(result.rows[0]).toBe('a');
    expect(result.rows[4]).toBe('e');
    expect(result.rows[5]).toBe('');
    expect(result.rows[9]).toBe('');
  });

  it('buffer equals screen: returns all rows, no padding', () => {
    const vp = new Viewport();
    const buffer = Array.from({ length: 10 }, (_, i) => `row ${i}`);
    const result = vp.resolve(buffer, 10, 0, 0);
    expect(result.rows.length).toBe(10);
    expect(result.rows[0]).toBe('row 0');
    expect(result.rows[9]).toBe('row 9');
  });

  it('buffer taller than screen: returns exactly screenRows rows', () => {
    const vp = new Viewport();
    const buffer = Array.from({ length: 50 }, (_, i) => `row ${i}`);
    const result = vp.resolve(buffer, 10, 0, 0);
    expect(result.rows.length).toBe(10);
  });

  it('cursor at row 0: scrollOffset = 0, visibleCursorRow = 0', () => {
    const vp = new Viewport();
    const buffer = Array.from({ length: 5 }, (_, i) => `row ${i}`);
    const result = vp.resolve(buffer, 10, 0, 3);
    expect(result.visibleCursorRow).toBe(0);
    expect(result.visibleCursorCol).toBe(3);
  });

  it('cursor at row 45 (buffer 50, screen 10): scrollOffset adjusts, visibleCursorRow within 0-9', () => {
    const vp = new Viewport();
    const buffer = Array.from({ length: 50 }, (_, i) => `row ${i}`);
    const result = vp.resolve(buffer, 10, 45, 0);
    expect(result.visibleCursorRow).toBeGreaterThanOrEqual(0);
    expect(result.visibleCursorRow).toBeLessThanOrEqual(9);
    // cursor at 45, screen 10 => scrollOffset = 45 - 10 + 1 = 36, visibleCursorRow = 45 - 36 = 9
    expect(result.visibleCursorRow).toBe(9);
    expect(result.rows[9]).toBe('row 45');
  });

  it('cursor in stable range: scrollOffset does not change when cursor is already visible', () => {
    const vp = new Viewport();
    const buffer = Array.from({ length: 50 }, (_, i) => `row ${i}`);
    // First call places cursor at row 45 (scrollOffset = 36)
    vp.resolve(buffer, 10, 45, 0);
    // Second call: cursor moves to row 40 (still in 36..45 range)
    const result = vp.resolve(buffer, 10, 40, 0);
    // scrollOffset stays 36, visibleCursorRow = 40 - 36 = 4
    expect(result.visibleCursorRow).toBe(4);
    expect(result.rows[4]).toBe('row 40');
  });

  it('cursor chasing up: cursor moves above viewport, scrollOffset snaps to cursorRow', () => {
    const vp = new Viewport();
    const buffer = Array.from({ length: 50 }, (_, i) => `row ${i}`);
    // First call: cursor at 45, scrollOffset = 36
    vp.resolve(buffer, 10, 45, 0);
    // Second call: cursor jumps to row 5 (below scrollOffset=36)
    const result = vp.resolve(buffer, 10, 5, 0);
    // scrollOffset snaps to 5, visibleCursorRow = 0
    expect(result.visibleCursorRow).toBe(0);
    expect(result.rows[0]).toBe('row 5');
  });

  it('cursor chasing down: scrollOffset = cursorRow - screenRows + 1', () => {
    const vp = new Viewport();
    const buffer = Array.from({ length: 50 }, (_, i) => `row ${i}`);
    // First call: cursor at 0, scrollOffset = 0
    vp.resolve(buffer, 10, 0, 0);
    // Second call: cursor jumps to row 20 (beyond 0 + 10 - 1 = 9)
    const result = vp.resolve(buffer, 10, 20, 0);
    // scrollOffset = 20 - 10 + 1 = 11, visibleCursorRow = 20 - 11 = 9
    expect(result.visibleCursorRow).toBe(9);
    expect(result.rows[9]).toBe('row 20');
  });

  it('resize shrink (24 to 10): scrollOffset capped, cursor still visible', () => {
    const vp = new Viewport();
    const buffer = Array.from({ length: 50 }, (_, i) => `row ${i}`);
    // First call at screen height 24, cursor at 30
    // scrollOffset = 30 - 24 + 1 = 7
    vp.resolve(buffer, 24, 30, 0);
    // Resize to 10: scrollOffset capped at max(0, 50 - 10) = 40, then cursor chasing
    // cursor 30 < scrollOffset(after cap)... let's trace:
    // After cap: scrollOffset = min(7, max(0, 50 - 10)) = min(7, 40) = 7
    // Then cursor chasing: cursorRow(30) >= 7 + 10 = 17 => scrollOffset = 30 - 10 + 1 = 21
    // visibleCursorRow = 30 - 21 = 9
    const result = vp.resolve(buffer, 10, 30, 0);
    expect(result.rows.length).toBe(10);
    expect(result.visibleCursorRow).toBeGreaterThanOrEqual(0);
    expect(result.visibleCursorRow).toBeLessThanOrEqual(9);
  });

  it('resize grow (10 to 24): more content visible, scrollOffset does not increase', () => {
    const vp = new Viewport();
    const buffer = Array.from({ length: 50 }, (_, i) => `row ${i}`);
    // First call at screen 10, cursor at 45 => scrollOffset = 36
    vp.resolve(buffer, 10, 45, 0);
    // Grow to 24, cursor still at 45
    // cap: scrollOffset = min(36, max(0, 50 - 24)) = min(36, 26) = 26
    // cursor chasing: 45 >= 26 + 24 = 50? No. 45 < 26? No. => stays 26
    // visibleCursorRow = 45 - 26 = 19
    const result = vp.resolve(buffer, 24, 45, 0);
    expect(result.rows.length).toBe(24);
    expect(result.visibleCursorRow).toBeGreaterThanOrEqual(0);
    expect(result.visibleCursorRow).toBeLessThanOrEqual(23);
  });

  it('visibleCursorCol always equals input cursorCol', () => {
    const vp = new Viewport();
    const buffer = ['a', 'b', 'c'];
    const result = vp.resolve(buffer, 10, 1, 42);
    expect(result.visibleCursorCol).toBe(42);
  });
});
