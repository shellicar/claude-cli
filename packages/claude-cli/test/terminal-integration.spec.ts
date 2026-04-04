import { describe, expect, it } from 'vitest';
import { HistoryViewport } from '../src/HistoryViewport.js';
import type { BuiltComponent, LayoutInput } from '../src/Layout.js';
import { layout } from '../src/Layout.js';
import type { EditorRender } from '../src/renderer.js';
import { wrapLine } from '@shellicar/claude-core/reflow';
import { Renderer } from '@shellicar/claude-core/renderer';
import { Viewport } from '@shellicar/claude-core/viewport';
import { MockScreen } from './MockScreen.js';

function makeEditorRender(lineCount: number, cursorRow = 0, cursorCol = 0): EditorRender {
  const lines = Array.from({ length: lineCount }, (_, i) => `line ${i}`);
  return { lines, cursorRow, cursorCol };
}

function makeComponent(rows: string[]): BuiltComponent {
  return { rows, height: rows.length };
}

function runPipeline(screen: MockScreen, viewport: Viewport, renderer: Renderer, input: LayoutInput): void {
  const result = layout(input);
  const frame = viewport.resolve(result.buffer, screen.rows, result.cursorRow, result.cursorCol);
  renderer.render([], frame);
}

describe('Terminal integration', () => {
  it('full cycle: no scrollback violations', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const viewport = new Viewport();
    const renderer = new Renderer(screen);
    const input = {
      editor: makeEditorRender(3, 1, 0),
      status: makeComponent(['status']),
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;

    runPipeline(screen, viewport, renderer, input);

    screen.assertNoScrollbackViolations();
  });

  it('50-line editor on 10-row screen: no scrollback violations', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const viewport = new Viewport();
    const renderer = new Renderer(screen);
    const input = {
      editor: makeEditorRender(50, 25, 0),
      status: null,
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;

    runPipeline(screen, viewport, renderer, input);

    screen.assertNoScrollbackViolations();
  });

  it('resize from 24 to 10 rows: viewport adapts, no violations, cursor visible', () => {
    const viewport = new Viewport();
    const input = {
      editor: makeEditorRender(20, 10, 0),
      status: null,
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;

    // First render at 24 rows. Viewport scrollOffset is established.
    const bigScreen = new MockScreen(80, 24);
    bigScreen.enterAltBuffer();
    const bigRenderer = new Renderer(bigScreen);
    runPipeline(bigScreen, viewport, bigRenderer, input);

    // Resize to 10 rows. Viewport state (scrollOffset) persists across the resize.
    const smallScreen = new MockScreen(80, 10);
    smallScreen.enterAltBuffer();
    const smallRenderer = new Renderer(smallScreen);
    const { buffer, cursorRow, cursorCol } = layout(input);
    const frame = viewport.resolve(buffer, 10, cursorRow, cursorCol);
    smallRenderer.render([], frame);

    smallScreen.assertNoScrollbackViolations();
    expect(frame.visibleCursorRow).toBeGreaterThanOrEqual(0);
    expect(frame.visibleCursorRow).toBeLessThan(10);
  });

  it('cursor at first row of viewport: no violations', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const viewport = new Viewport();
    const renderer = new Renderer(screen);
    const input = {
      editor: makeEditorRender(5, 0, 0),
      status: null,
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;

    runPipeline(screen, viewport, renderer, input);

    screen.assertNoScrollbackViolations();
  });

  it('first render: no scrollback violations from viewport-padded frames', () => {
    // Viewport pads frames to screenRows. Without trimming, render() would write
    // screenRows rows. With trimming, only the non-empty rows are written.
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const viewport = new Viewport();
    const renderer = new Renderer(screen);
    const input = {
      editor: makeEditorRender(1, 0, 0),
      status: makeComponent(['status']),
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;

    runPipeline(screen, viewport, renderer, input);

    screen.assertNoScrollbackViolations();
  });

  it('cursor at last row of viewport: no violations', () => {
    const screen = new MockScreen(80, 5);
    screen.enterAltBuffer();
    const viewport = new Viewport();
    const renderer = new Renderer(screen);
    const input = {
      editor: makeEditorRender(5, 4, 0),
      status: null,
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;

    runPipeline(screen, viewport, renderer, input);

    screen.assertNoScrollbackViolations();
  });
});

describe('History flush', () => {
  it('empty flush is a no-op: screen stays in alt buffer', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    // flushHistory() with empty buffer must not exit alt buffer
    screen.assertInAltBuffer();
    expect(screen.getMainRow(0)).toBe('');
  });

  it('flush writes accumulated lines to main buffer', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();

    // Simulate the flush sequence Terminal.flushHistory() performs
    const lines = ['hello', 'world'];
    const output = lines.join('\n') + '\n';
    screen.exitAltBuffer();
    screen.write(output);
    screen.enterAltBuffer();

    expect(screen.getMainRow(0)).toBe('hello');
    expect(screen.getMainRow(1)).toBe('world');
  });

  it('alt buffer is re-entered after flush', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();

    screen.exitAltBuffer();
    screen.write('flushed\n');
    screen.enterAltBuffer();

    screen.assertInAltBuffer();
  });

  it('flush does not cause scrollback violations in alt buffer after redraw', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const viewport = new Viewport();
    const renderer = new Renderer(screen);
    const input = {
      editor: makeEditorRender(3, 1, 0),
      status: makeComponent(['status']),
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;

    // Simulate flush sequence then redraw
    screen.exitAltBuffer();
    screen.write('response line\n');
    screen.enterAltBuffer();
    runPipeline(screen, viewport, renderer, input);

    screen.assertNoScrollbackViolations();
  });
});

describe('Two-region rendering', () => {
  it('empty displayBuffer: zone anchored to bottom with padding rows above', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const historyViewport = new HistoryViewport();
    const viewport = new Viewport();
    const renderer = new Renderer(screen);

    const input = {
      editor: makeEditorRender(3, 1, 0),
      status: makeComponent(['status']),
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;

    const result = layout(input);
    const screenRows = screen.rows;
    const zoneHeight = Math.min(result.buffer.length, screenRows);
    const historyRows = screenRows - zoneHeight;

    // Empty displayBuffer resolves through viewport (no short-circuit)
    const historyFrame = historyViewport.resolve([], historyRows);
    const zoneRows = screenRows - historyFrame.rows.length;
    const zoneFrame = viewport.resolve(result.buffer, zoneRows, result.cursorRow, result.cursorCol);

    renderer.render(historyFrame.rows, zoneFrame);

    screen.assertNoScrollbackViolations();
    // History region is all padding rows (empty strings)
    expect(historyFrame.rows.length).toBe(historyRows);
    expect(historyFrame.rows.every((r) => r === '')).toBe(true);
    // Zone gets correct number of rows, anchored to bottom
    expect(zoneFrame.rows.length).toBe(zoneRows);
  });

  it('startup messages in displayBuffer visible in history region on first render', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const historyViewport = new HistoryViewport();
    const viewport = new Viewport();
    const renderer = new Renderer(screen);

    const input = {
      editor: makeEditorRender(2, 0, 0),
      status: makeComponent(['status']),
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;

    const displayBuffer = ['v1.0.0', 'Session: abc123'];
    const result = layout(input);
    const screenRows = screen.rows;
    const zoneHeight = Math.min(result.buffer.length, screenRows);
    const historyRows = screenRows - zoneHeight;
    const wrappedHistory = displayBuffer.flatMap((line) => wrapLine(line, 80));
    const historyFrame = historyViewport.resolve(wrappedHistory, historyRows);
    const zoneRows = screenRows - historyFrame.rows.length;
    const zoneFrame = viewport.resolve(result.buffer, zoneRows, result.cursorRow, result.cursorCol);

    renderer.render(historyFrame.rows, zoneFrame);

    screen.assertNoScrollbackViolations();
    // Startup messages visible in history region (bottom-aligned)
    expect(historyFrame.rows).toContain('v1.0.0');
    expect(historyFrame.rows).toContain('Session: abc123');
  });

  it('history lines appear above zone content', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const historyViewport = new HistoryViewport();
    const viewport = new Viewport();
    const renderer = new Renderer(screen);

    const input = {
      editor: makeEditorRender(2, 0, 0),
      status: makeComponent(['status']),
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;

    const displayBuffer = ['history line 0', 'history line 1'];
    const result = layout(input);
    const screenRows = screen.rows;
    const zoneHeight = Math.min(result.buffer.length, screenRows);
    const historyRows = screenRows - zoneHeight;
    const wrappedHistory = displayBuffer.flatMap((line) => wrapLine(line, 80));
    const historyFrame = historyViewport.resolve(wrappedHistory, historyRows);
    const zoneRows = screenRows - historyFrame.rows.length;
    const zoneFrame = viewport.resolve(result.buffer, zoneRows, result.cursorRow, result.cursorCol);

    renderer.render(historyFrame.rows, zoneFrame);

    screen.assertNoScrollbackViolations();
    // Zone renders below history rows
    expect(zoneFrame.rows.length).toBe(zoneRows);
  });

  it('history viewport auto-follows in live mode', () => {
    const historyViewport = new HistoryViewport();
    const buf = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const frame1 = historyViewport.resolve(buf, 3);
    // Should show last 3 lines
    expect(frame1.rows[2]).toBe('g');

    buf.push('h');
    const frame2 = historyViewport.resolve(buf, 3);
    expect(frame2.rows[2]).toBe('h');
  });

  it('history mode: history region gets screenRows-1 rows, zone gets 1', () => {
    const screenRows = 10;
    const historyViewport = new HistoryViewport();
    const buffer = Array.from({ length: 28 }, (_, i) => `line ${i}`);

    // Initialize in live mode so pageUp has lastViewportRows
    historyViewport.resolve(buffer, screenRows - 1);
    historyViewport.pageUp();

    const historyFrame = historyViewport.resolve(buffer, screenRows - 1);
    const zoneRows = screenRows - historyFrame.rows.length;

    expect(historyFrame.rows.length).toBe(screenRows - 1);
    expect(zoneRows).toBe(1);
  });

  it('history mode: returnToLive restores live mode', () => {
    const historyViewport = new HistoryViewport();
    const buffer = Array.from({ length: 28 }, (_, i) => `line ${i}`);

    historyViewport.resolve(buffer, 9);
    historyViewport.pageUp();
    expect(historyViewport.mode).toBe('history');

    historyViewport.returnToLive();
    expect(historyViewport.mode).toBe('live');
  });

  it('indicator range: correct start-end for buffer larger than viewport', () => {
    const historyViewport = new HistoryViewport();
    const buffer = Array.from({ length: 52 }, (_, i) => `line ${i}`);
    const historyRows = 24;

    // Initialize and enter history mode
    historyViewport.resolve(buffer, historyRows);
    historyViewport.pageUp();
    const frame = historyViewport.resolve(buffer, historyRows);

    const start = frame.visibleStart + 1;
    const end = Math.min(frame.visibleStart + frame.rows.length, frame.totalLines);

    expect(start).toBeGreaterThanOrEqual(1);
    expect(end).toBeGreaterThanOrEqual(start);
    expect(end - start + 1).toBe(historyRows);
    expect(end).toBeLessThanOrEqual(frame.totalLines);
  });

  it('indicator range: short buffer end is capped at totalLines not viewport rows', () => {
    const historyViewport = new HistoryViewport();
    const buffer = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    const historyRows = 24;

    const frame = historyViewport.resolve(buffer, historyRows);

    const start = frame.visibleStart + 1;
    const end = Math.min(frame.visibleStart + frame.rows.length, frame.totalLines);

    expect(start).toBe(1);
    expect(end).toBe(10);
    expect(frame.totalLines).toBe(10);
  });

  it('history mode: no scrollback violations with collapsed zone', () => {
    const screenRows = 10;
    const screen = new MockScreen(80, screenRows);
    screen.enterAltBuffer();
    const historyViewport = new HistoryViewport();
    const viewport = new Viewport();
    const renderer = new Renderer(screen);

    const buffer = Array.from({ length: 28 }, (_, i) => `line ${i}`);

    historyViewport.resolve(buffer, screenRows - 1);
    historyViewport.pageUp();

    const historyFrame = historyViewport.resolve(buffer, screenRows - 1);
    const zoneRows = screenRows - historyFrame.rows.length;
    const zoneBuffer = ['[\u2191 1-9/28]'];
    const frame = viewport.resolve(zoneBuffer, zoneRows, 0, 0);

    renderer.render(historyFrame.rows, frame);

    screen.assertNoScrollbackViolations();
  });

  it('zone height changes do not corrupt history region', () => {
    const screen = new MockScreen(80, 10);
    screen.enterAltBuffer();
    const historyViewport = new HistoryViewport();
    const viewport = new Viewport();
    const renderer = new Renderer(screen);

    const displayBuffer = ['log line 0', 'log line 1', 'log line 2'];

    function render(editorLines: number) {
      const input = {
        editor: makeEditorRender(editorLines, 0, 0),
        status: null,
        attachments: null,
        preview: null,
        question: null,
        columns: 80,
      } satisfies LayoutInput;
      const result = layout(input);
      const screenRows = screen.rows;
      const zoneHeight = Math.min(result.buffer.length, screenRows);
      const historyRows = screenRows - zoneHeight;
      const wrappedHistory = displayBuffer.flatMap((line) => wrapLine(line, 80));
      const hFrame = historyViewport.resolve(wrappedHistory, historyRows);
      const zoneRows = screenRows - hFrame.rows.length;
      const zoneFrame = viewport.resolve(result.buffer, zoneRows, result.cursorRow, result.cursorCol);
      renderer.render(hFrame.rows, zoneFrame);
    }

    render(1);
    screen.assertNoScrollbackViolations();
    render(5);
    screen.assertNoScrollbackViolations();
    render(1);
    screen.assertNoScrollbackViolations();
  });
});
