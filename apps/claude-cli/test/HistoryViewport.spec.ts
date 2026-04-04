import { describe, expect, it } from 'vitest';
import { HistoryViewport } from '../src/HistoryViewport.js';

function makeBuffer(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `line ${i}`);
}

describe('HistoryViewport', () => {
  it('starts in live mode', () => {
    const vp = new HistoryViewport();
    expect(vp.mode).toBe('live');
  });

  it('resolve with rows <= 0 returns empty rows', () => {
    const vp = new HistoryViewport();
    const frame = vp.resolve(makeBuffer(10), 0);
    expect(frame.rows).toEqual([]);
    expect(frame.totalLines).toBe(10);
    expect(frame.visibleStart).toBe(0);
  });

  it('resolve with empty buffer returns padded empty rows', () => {
    const vp = new HistoryViewport();
    const frame = vp.resolve([], 5);
    expect(frame.rows).toHaveLength(5);
    expect(frame.rows.every((r) => r === '')).toBe(true);
    expect(frame.totalLines).toBe(0);
  });

  it('live mode: auto-follows bottom when buffer > rows', () => {
    const vp = new HistoryViewport();
    const buf = makeBuffer(20);
    const frame = vp.resolve(buf, 5);
    // Should show lines 15-19
    expect(frame.rows[0]).toBe('line 15');
    expect(frame.rows[4]).toBe('line 19');
    expect(frame.visibleStart).toBe(15);
  });

  it('live mode: top-pads when buffer < rows', () => {
    const vp = new HistoryViewport();
    const buf = makeBuffer(3);
    const frame = vp.resolve(buf, 10);
    // 7 empty rows then 3 content rows
    expect(frame.rows).toHaveLength(10);
    expect(frame.rows[0]).toBe('');
    expect(frame.rows[6]).toBe('');
    expect(frame.rows[7]).toBe('line 0');
    expect(frame.rows[9]).toBe('line 2');
  });

  it('live mode: new lines added after resolve cause auto-follow on next resolve', () => {
    const vp = new HistoryViewport();
    const buf = makeBuffer(5);
    vp.resolve(buf, 5);
    // Add more lines
    buf.push('line 5');
    buf.push('line 6');
    const frame = vp.resolve(buf, 5);
    // Should show lines 2-6
    expect(frame.rows[4]).toBe('line 6');
  });

  it('pageUp enters history mode', () => {
    const vp = new HistoryViewport();
    vp.resolve(makeBuffer(20), 5);
    vp.pageUp();
    expect(vp.mode).toBe('history');
  });

  it('pageUp is a no-op when no buffer', () => {
    const vp = new HistoryViewport();
    vp.resolve([], 5);
    vp.pageUp();
    expect(vp.mode).toBe('live');
  });

  it('returnToLive switches back to live mode', () => {
    const vp = new HistoryViewport();
    vp.resolve(makeBuffer(20), 5);
    vp.pageUp();
    vp.returnToLive();
    expect(vp.mode).toBe('live');
  });

  it('history mode: viewport pinned, new content does not scroll', () => {
    const vp = new HistoryViewport();
    const buf = makeBuffer(20);
    // Resolve to establish state, then page up
    vp.resolve(buf, 5);
    vp.pageUp();
    const frame1 = vp.resolve(buf, 5);
    const start1 = frame1.visibleStart;
    // Add more lines
    buf.push('line 20');
    buf.push('line 21');
    const frame2 = vp.resolve(buf, 5);
    // Viewport should remain pinned (visibleStart unchanged)
    expect(frame2.visibleStart).toBe(start1);
  });

  it('pageDown from bottom returns to live mode', () => {
    const vp = new HistoryViewport();
    const buf = makeBuffer(10);
    vp.resolve(buf, 5);
    vp.pageUp(); // scroll to start
    // Page down to bottom
    vp.pageDown();
    vp.pageDown();
    vp.pageDown();
    expect(vp.mode).toBe('live');
  });

  it('lineUp enters history mode', () => {
    const vp = new HistoryViewport();
    vp.resolve(makeBuffer(20), 5);
    vp.lineUp();
    expect(vp.mode).toBe('history');
  });

  it('lineDown at bottom returns to live mode', () => {
    const vp = new HistoryViewport();
    const buf = makeBuffer(10);
    vp.resolve(buf, 5);
    vp.lineUp();
    // Scroll back to bottom
    for (let i = 0; i < 20; i++) {
      vp.lineDown();
    }
    expect(vp.mode).toBe('live');
  });
});

describe('Position indicator data', () => {
  it('live mode: totalLines and visibleStart reflect current position', () => {
    const vp = new HistoryViewport();
    const buf = makeBuffer(20);
    const frame = vp.resolve(buf, 5);
    expect(frame.totalLines).toBe(20);
    // In live mode, auto-follows bottom: visibleStart = 20 - 5 = 15
    expect(frame.visibleStart).toBe(15);
  });

  it('history mode: frame provides correct visibleStart for indicator', () => {
    const vp = new HistoryViewport();
    const buf = makeBuffer(20);
    vp.resolve(buf, 5);
    vp.pageUp();
    const frame = vp.resolve(buf, 5);
    // After one page-up from bottom (offset=15), subtract 5 => offset=10
    expect(frame.visibleStart).toBe(10);
    expect(frame.totalLines).toBe(20);
    expect(vp.mode).toBe('history');
  });

  it('history mode indicator: visibleStart is 1-based display position', () => {
    const vp = new HistoryViewport();
    const buf = makeBuffer(20);
    vp.resolve(buf, 5);
    vp.pageUp();
    const frame = vp.resolve(buf, 5);
    // Status line shows (visibleStart + 1) / totalLines
    const displayStart = frame.visibleStart + 1;
    expect(displayStart).toBe(11);
    expect(frame.totalLines).toBe(20);
  });
});
