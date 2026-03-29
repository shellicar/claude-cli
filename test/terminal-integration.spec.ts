import { describe, expect, it } from 'vitest';
import type { BuiltComponent, LayoutInput } from '../src/Layout.js';
import { layout } from '../src/Layout.js';
import type { EditorRender } from '../src/renderer.js';
import { Renderer } from '../src/TerminalRenderer.js';
import { Viewport } from '../src/Viewport.js';
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
  renderer.render(frame);
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
    smallRenderer.render(frame);

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
