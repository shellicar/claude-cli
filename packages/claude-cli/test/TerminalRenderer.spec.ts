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
    enterAltBuffer() {},
    exitAltBuffer() {},
  };
  return { screen, output };
}

function makeFrame(rows: string[], visibleCursorRow: number, visibleCursorCol: number): ViewportResult {
  return { rows, visibleCursorRow, visibleCursorCol };
}

describe('Renderer', () => {
  it('render() always starts with cursorAt(1,1)', () => {
    const { screen, output } = makeScreen(80);
    const renderer = new Renderer(screen);
    renderer.render([], makeFrame(['line0', 'line1'], 0, 0));
    const all = output.join('');
    expect(all).toContain('\x1B[1;1H');
  });

  it('second render also starts with cursorAt(1,1) (stateless)', () => {
    const { screen, output } = makeScreen(80);
    const renderer = new Renderer(screen);
    renderer.render([], makeFrame(['a', 'b'], 0, 0));
    output.length = 0;
    renderer.render([], makeFrame(['c', 'd'], 0, 0));
    const all = output.join('');
    expect(all).toContain('\x1B[1;1H');
    expect(all).not.toContain('\x1B[1A'); // no cursorUp in alt buffer
  });

  it('single frame on 10-row screen: no scrollback violations', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const renderer = new Renderer(screen);
    renderer.render([], makeFrame(['line 0', 'line 1', 'line 2', 'line 3', 'line 4'], 2, 0));
    screen.assertNoScrollbackViolations();
  });

  it('frame filling entire 10-row screen: exactly 10 rows written, no violations', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const renderer = new Renderer(screen);
    const rows = Array.from({ length: 10 }, (_, i) => `row ${i}`);
    renderer.render([], makeFrame(rows, 9, 0));
    screen.assertNoScrollbackViolations();
    for (let i = 0; i < 10; i++) {
      expect(screen.getRow(i)).toBe(`row ${i}`);
    }
  });

  it('two consecutive frames: no violations, screen shows second frame content', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const renderer = new Renderer(screen);
    renderer.render([], makeFrame(['a0', 'a1', 'a2', 'a3', 'a4'], 2, 0));
    renderer.render([], makeFrame(['b0', 'b1', 'b2', 'b3', 'b4'], 2, 0));
    screen.assertNoScrollbackViolations();
    expect(screen.getRow(0)).toBe('b0');
    expect(screen.getRow(4)).toBe('b4');
  });

  it('shorter frame after taller frame: leftover rows cleared, no violations', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const renderer = new Renderer(screen);
    renderer.render(
      [],
      makeFrame(
        Array.from({ length: 8 }, (_, i) => `long${i}`),
        4,
        0,
      ),
    );
    renderer.render([], makeFrame(['short0', 'short1', 'short2'], 1, 0));
    screen.assertNoScrollbackViolations();
    expect(screen.getRow(0)).toBe('short0');
    expect(screen.getRow(2)).toBe('short2');
    // Leftover rows from 8-row frame cleared
    expect(screen.getRow(3)).toBe('');
    expect(screen.getRow(7)).toBe('');
  });

  it('cursor position: after render, cursor is at (visibleCursorRow, visibleCursorCol)', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const renderer = new Renderer(screen);
    renderer.render([], makeFrame(['a', 'b', 'c', 'd', 'e'], 3, 15));
    expect(screen.cursorRow).toBe(3);
    expect(screen.cursorCol).toBe(15);
  });

  it('cursor positioned via cursorAt not cursorUp+cursorTo', () => {
    const { screen, output } = makeScreen(80);
    const renderer = new Renderer(screen);
    renderer.render([], makeFrame(['row0', 'row1', 'row2'], 2, 5));
    const all = output.join('');
    // Cursor placed via absolute ESC[row;colH, not cursorUp
    expect(all).toContain('\x1B[3;6H'); // row 3 (1-based), col 6 (1-based)
    expect(all).not.toContain('\x1B[1A'); // no cursorUp
  });
});

describe('MockScreen dual-buffer', () => {
  it('starts in main buffer', () => {
    const screen = new MockScreen(80, 10);
    screen.assertInMainBuffer();
  });

  it('enterAltBuffer switches to alt buffer', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    screen.assertInAltBuffer();
  });

  it('exitAltBuffer returns to main buffer', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    screen.exitAltBuffer();
    screen.assertInMainBuffer();
  });

  it('alt buffer starts empty', () => {
    const screen = new MockScreen(80, 5);
    screen.write('main content');
    screen.enterAltBuffer();
    expect(screen.getRow(0)).toBe('');
  });

  it('main buffer content preserved after exit', () => {
    const screen = new MockScreen(80, 5);
    screen.write('main content');
    screen.enterAltBuffer();
    screen.write('alt content');
    screen.exitAltBuffer();
    expect(screen.getRow(0)).toBe('main content');
  });

  it('getMainRow returns main buffer content while in alt buffer', () => {
    const screen = new MockScreen(80, 5);
    screen.write('hello');
    screen.enterAltBuffer();
    expect(screen.getMainRow(0)).toBe('hello');
  });

  it('enterAltBuffer is idempotent', () => {
    const screen = new MockScreen(80, 5);
    screen.write('before');
    screen.enterAltBuffer();
    screen.write('alt1');
    screen.enterAltBuffer(); // no-op
    expect(screen.getRow(0)).toBe('alt1');
    screen.assertInAltBuffer();
  });

  it('exitAltBuffer is idempotent', () => {
    const screen = new MockScreen(80, 5);
    screen.exitAltBuffer(); // no-op
    screen.assertInMainBuffer();
  });

  it('no scrollback violations in alt buffer across two frames', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const renderer = new Renderer(screen);
    renderer.render([], makeFrame(['z0', 'z1', 'z2'], 0, 0));
    renderer.render([], makeFrame(['z3', 'z4', 'z5'], 0, 0));
    screen.assertNoScrollbackViolations();
  });
});
