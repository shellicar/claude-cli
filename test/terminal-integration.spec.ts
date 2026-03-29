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
    const bigRenderer = new Renderer(bigScreen);
    runPipeline(bigScreen, viewport, bigRenderer, input);

    // Resize to 10 rows. Viewport state (scrollOffset) persists across the resize.
    const smallScreen = new MockScreen(80, 10);
    const smallRenderer = new Renderer(smallScreen);
    const { buffer, cursorRow, cursorCol } = layout(input);
    const frame = viewport.resolve(buffer, 10, cursorRow, cursorCol);
    smallRenderer.render(frame);

    smallScreen.assertNoScrollbackViolations();
    expect(frame.visibleCursorRow).toBeGreaterThanOrEqual(0);
    expect(frame.visibleCursorRow).toBeLessThan(10);
  });

  it('writeHistory during active editor: no violations', () => {
    const screen = new MockScreen(80, 20);
    const viewport = new Viewport();
    const renderer = new Renderer(screen);
    const input = {
      editor: makeEditorRender(3, 1, 0),
      status: null,
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;

    runPipeline(screen, viewport, renderer, input);
    renderer.writeHistory('a history line');

    screen.assertNoScrollbackViolations();
  });

  it('question cleared before history write: zone re-renders without question', () => {
    // Reproduces the bug where renderer.writeHistory re-rendered lastFrame
    // (stale, containing the question) instead of the current layout state.
    // Fix: writeHistoryLine + fresh runPipeline so zone reflects current state.
    const screen = new MockScreen(80, 20);
    const viewport = new Viewport();
    const renderer = new Renderer(screen);

    // Initial render: zone includes a question component.
    const withQuestion = {
      editor: makeEditorRender(2, 0, 0),
      status: makeComponent(['status']),
      attachments: null,
      preview: null,
      question: makeComponent(['Pick one:', '1) Yes', '2) No']),
      columns: 80,
    } satisfies LayoutInput;
    runPipeline(screen, viewport, renderer, withQuestion);

    // Question is answered: clearQuestionLines() was called. Now history is
    // written. The zone must re-render WITHOUT the question.
    const withoutQuestion = {
      editor: makeEditorRender(2, 0, 0),
      status: makeComponent(['status']),
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;
    renderer.writeHistoryLine('answer: Yes');
    runPipeline(screen, viewport, renderer, withoutQuestion);

    screen.assertNoScrollbackViolations();
    // Question content must not appear in any visible row.
    expect(screen.getRow(0)).toBe('answer: Yes');
    const visibleRows = Array.from({ length: 20 }, (_, i) => screen.getRow(i));
    expect(visibleRows.some((r) => r.includes('Pick one:'))).toBe(false);
  });

  it('cursor at first row of viewport: no violations', () => {
    const screen = new MockScreen(80, 10);
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

  it('first render with cursor mid-screen: no scrollback violations', () => {
    // Simulates startup: previous output leaves cursor at row 7 of a 10-row screen.
    // Content is 2 rows (status + 1 editor line). Viewport pads the frame to 10 rows.
    // Without trimming, render() would write 10 rows from row 7, causing 7 scrollback
    // violations (\n at row 9 fires 7 times). With trimming, only 2 rows are written
    // (rows 7-8), leaving row 9 untouched.
    const screen = new MockScreen(80, 10);
    const viewport = new Viewport();
    const renderer = new Renderer(screen);
    screen.cursorRow = 7;
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

  it('short history line does not leave stale zone content on same row', () => {
    // Reproduces the bug where writeHistoryLine lacked clearLine.
    // A zone row (80-char wide) at zone top, then a shorter history line
    // written there, left old zone content at cols history_len..79 visible.
    const screen = new MockScreen(80, 10);
    const viewport = new Viewport();
    const renderer = new Renderer(screen);
    const wideRow = 'A'.repeat(80);
    const input = {
      editor: makeEditorRender(1, 0, 0),
      status: makeComponent([wideRow]),
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    } satisfies LayoutInput;

    runPipeline(screen, viewport, renderer, input);

    // Write a history line shorter than the 80-char zone row.
    const shortHistory = 'short line';
    renderer.writeHistoryLine(shortHistory);
    // Re-render zone so the history row is now in scrollback.
    const { buffer, cursorRow, cursorCol } = layout(input);
    const frame = viewport.resolve(buffer, screen.rows, cursorRow, cursorCol);
    renderer.render(frame);

    // Row 0 must contain only the history text, no stale zone content.
    expect(screen.getRow(0)).toBe(shortHistory);
  });
});
