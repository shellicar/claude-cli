import { describe, expect, it } from 'vitest';
import type { Screen } from '../src/Screen.js';
import { Renderer } from '../src/TerminalRenderer.js';
import type { ViewportResult } from '../src/Viewport.js';
import { MockScreen } from './MockScreen.js';

function makeScreen(columns: number) {
  const output: string[] = [];
  const screen: Screen = {
    columns,
    rows: 24,
    write(data: string) {
      output.push(data);
    },
    onResize() {
      return () => {};
    },
  };
  return { screen, output };
}

function makeFrame(rows: string[], visibleCursorRow: number, visibleCursorCol: number): ViewportResult {
  return { rows, visibleCursorRow, visibleCursorCol };
}

describe('Renderer', () => {
  describe('lastVisibleCursorRow after render', () => {
    it('does not overcount when a row above the cursor exactly fills terminal width', () => {
      const cols = 10;
      const { screen, output } = makeScreen(cols);
      const renderer = new Renderer(screen);

      // Row 0 is exactly cols-wide; cursor sits on row 1
      const frame = {
        rows: ['a'.repeat(cols), 'x'],
        visibleCursorRow: 1,
        visibleCursorCol: 1,
      };

      renderer.render(frame);
      output.length = 0;

      // Second render: should move up by 1 (lastVisibleCursorRow = 1), not 2
      renderer.render(frame);
      const all = output.join('');

      expect(all).toContain('\x1B[1A'); // cursorUp(1): correct
      expect(all).not.toContain('\x1B[2A'); // cursorUp(2): was the bug
    });

    it('moves up correctly when no row above the cursor fills terminal width', () => {
      const cols = 10;
      const { screen, output } = makeScreen(cols);
      const renderer = new Renderer(screen);

      const frame = {
        rows: ['abc', 'cursor'],
        visibleCursorRow: 1,
        visibleCursorCol: 6,
      };

      renderer.render(frame);
      output.length = 0;

      renderer.render(frame);
      const all = output.join('');

      expect(all).toContain('\x1B[1A');
      expect(all).not.toContain('\x1B[2A');
    });
  });

  it('single frame on 10-row screen: no scrollback violations', () => {
    const screen = new MockScreen(80, 10);
    const renderer = new Renderer(screen);
    renderer.render(makeFrame(['line 0', 'line 1', 'line 2', 'line 3', 'line 4'], 2, 0));
    screen.assertNoScrollbackViolations();
  });

  it('frame filling entire 10-row screen: exactly 10 rows written, no violations', () => {
    const screen = new MockScreen(80, 10);
    const renderer = new Renderer(screen);
    const rows = Array.from({ length: 10 }, (_, i) => `row ${i}`);
    renderer.render(makeFrame(rows, 9, 0));
    screen.assertNoScrollbackViolations();
    for (let i = 0; i < 10; i++) {
      expect(screen.getRow(i)).toBe(`row ${i}`);
    }
  });

  it('two consecutive frames: no violations, screen shows second frame content', () => {
    const screen = new MockScreen(80, 10);
    const renderer = new Renderer(screen);
    renderer.render(makeFrame(['a0', 'a1', 'a2', 'a3', 'a4'], 2, 0));
    renderer.render(makeFrame(['b0', 'b1', 'b2', 'b3', 'b4'], 2, 0));
    screen.assertNoScrollbackViolations();
    expect(screen.getRow(0)).toBe('b0');
    expect(screen.getRow(4)).toBe('b4');
  });

  it('shorter frame after taller frame: leftover rows cleared, no violations', () => {
    const screen = new MockScreen(80, 10);
    const renderer = new Renderer(screen);
    renderer.render(
      makeFrame(
        Array.from({ length: 8 }, (_, i) => `long${i}`),
        4,
        0,
      ),
    );
    renderer.render(makeFrame(['short0', 'short1', 'short2'], 1, 0));
    screen.assertNoScrollbackViolations();
    expect(screen.getRow(0)).toBe('short0');
    expect(screen.getRow(2)).toBe('short2');
    // Leftover rows from 8-row frame should be cleared
    expect(screen.getRow(3)).toBe('');
    expect(screen.getRow(7)).toBe('');
  });

  it('writeHistory then render: history line above zone, zone re-rendered, no violations', () => {
    const screen = new MockScreen(80, 20);
    const renderer = new Renderer(screen);
    renderer.render(makeFrame(['zone0', 'zone1', 'zone2', 'zone3', 'zone4'], 2, 0));
    renderer.writeHistory('history');
    screen.assertNoScrollbackViolations();
    expect(screen.getRow(0)).toBe('history');
    expect(screen.getRow(1)).toBe('zone0');
    expect(screen.getRow(5)).toBe('zone4');
  });

  it('writeHistory preserves zoneHeight: zoneHeight unchanged after writeHistory', () => {
    const screen = new MockScreen(80, 20);
    const renderer = new Renderer(screen);
    renderer.render(makeFrame(['z0', 'z1', 'z2', 'z3', 'z4'], 2, 0));
    const before = renderer.zoneHeight;
    renderer.writeHistory('a line');
    expect(renderer.zoneHeight).toBe(before);
  });

  it('multiple writeHistory calls between renders: each pushes zone down, no violations', () => {
    const screen = new MockScreen(80, 30);
    const renderer = new Renderer(screen);
    renderer.render(makeFrame(['z0', 'z1', 'z2', 'z3', 'z4'], 2, 0));
    for (let i = 0; i < 10; i++) {
      renderer.writeHistory(`history ${i}`);
    }
    screen.assertNoScrollbackViolations();
    // Zone has drifted 10 rows down from its original position at rows 0-4
    expect(screen.getRow(10)).toBe('z0');
    expect(screen.getRow(14)).toBe('z4');
  });

  it('cursor position: after render, cursor is at (visibleCursorRow, visibleCursorCol)', () => {
    const screen = new MockScreen(80, 10);
    const renderer = new Renderer(screen);
    renderer.render(makeFrame(['a', 'b', 'c', 'd', 'e'], 3, 15));
    expect(screen.cursorRow).toBe(3);
    expect(screen.cursorCol).toBe(15);
  });

  describe('resize: simulated terminal reflow', () => {
    it('widen resize: does not clear rows above new zone top', () => {
      // Bug: pendingResize path does cursorAt(1,1) + clearDown, erasing the entire
      // visible screen. When widening, the zone shrinks and more rows above become
      // visible (OS reflow). Those rows must NOT be cleared by the resize render.

      // 10-row screen. Initial zone: 5 rows at rows 5–9 (0-indexed).
      const screen = new MockScreen(80, 10);
      const renderer = new Renderer(screen);

      renderer.render(makeFrame(['zone0', 'zone1', 'zone2', 'zone3', 'zone4'], 0, 0));

      // Simulate OS widen reflow: old 5-row zone reflowed to 3 rows at new width.
      // Terminal now shows history at rows 0–6, old zone at rows 7–9.
      // Write history content directly into cells to represent what is visible.
      for (let r = 0; r < 7; r++) {
        const text = `history ${r}`;
        for (let c = 0; c < text.length; c++) {
          screen.cells[r][c] = text[c] as string;
        }
      }
      screen.cursorRow = 7;
      screen.cursorCol = 0;

      renderer.notifyResize();

      // New zone: 3 rows (wider terminal, less wrapping). newZoneTop = 10 - 3 + 1 = 8 (1-based) = row 7 (0-based).
      renderer.render(makeFrame(['zone0', 'zone1', 'zone2'], 0, 0));

      // History rows 0–6 must be preserved (not cleared by pendingResize).
      expect(screen.getRow(0)).toBe('history 0');
      expect(screen.getRow(6)).toBe('history 6');

      // New zone must be at rows 7–9.
      expect(screen.getRow(7)).toBe('zone0');
      expect(screen.getRow(8)).toBe('zone1');
      expect(screen.getRow(9)).toBe('zone2');
    });

    it('widen resize: zone stays in place instead of jumping to screen bottom', () => {
      // Bug: pendingResize used cursorAt(newZoneTop) which always anchors the zone
      // to the bottom of the screen. When widening, the cursor doesn't move, so the
      // zone should stay where it was (rows 0–2), not jump to the bottom (rows 7–9).

      const screen = new MockScreen(80, 10);
      const renderer = new Renderer(screen);

      // Initial render: 5-row zone at rows 0–4 (cursor at visibleCursorRow=0)
      renderer.render(makeFrame(['z0', 'z1', 'z2', 'z3', 'z4'], 0, 0));
      expect(screen.cursorRow).toBe(0);

      renderer.notifyResize();

      // Widen: new 3-row zone (less wrapping at wider columns)
      renderer.render(makeFrame(['z0', 'z1', 'z2'], 0, 0));

      // Zone must stay at rows 0–2, not jump to rows 7–9
      const actual0 = screen.getRow(0);
      const actual2 = screen.getRow(2);
      const actual7 = screen.getRow(7);

      expect(actual0).toBe('z0');
      expect(actual2).toBe('z2');
      expect(actual7).toBe('');

      screen.assertNoScrollbackViolations();
    });

    it('no scrollback violations when cursor displaced by terminal reflow before render', () => {
      // Resize bug: when the terminal is resized, the physical cursor moves because
      // content reflows. renderer.lastVisibleCursorRow is stale (based on the
      // pre-resize frame). The next render does cursorUp(stale), which moves the
      // cursor from the wrong row. A taller zone then overflows the screen bottom.

      const screen = new MockScreen(80, 5);
      const renderer = new Renderer(screen);

      // Phase 1: render a 2-row zone; cursor lands on row 1
      renderer.render(makeFrame(['first0', 'first1'], 1, 0));
      expect(screen.cursorRow).toBe(1);

      // Simulate terminal resize+reflow: cursor has been displaced to row 4
      screen.cursorRow = 4;
      renderer.notifyResize();

      // Phase 2: render a 4-row zone (zone grew because the terminal is now narrower)
      renderer.render(makeFrame(['new0', 'new1', 'new2', 'new3'], 3, 0));

      screen.assertNoScrollbackViolations();
    });
  });
});
