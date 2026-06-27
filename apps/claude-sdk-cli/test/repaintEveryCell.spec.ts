import { describe, expect, it } from 'vitest';
import { TerminalState } from '../src/model/TerminalState.js';
import { TerminalRenderer } from '../src/view/TerminalRenderer.js';
import { GridScreen } from './GridScreen.js';

describe('renderer repaints every cell', () => {
  it('a repaint of identical content scrubs a character injected behind its back', () => {
    const screen = new GridScreen(20, 4);
    const renderer = new TerminalRenderer(screen, new TerminalState());
    renderer.enter();

    const frame = ['line one', 'line two', '', 'line four'];
    renderer.paint(frame);

    // Something outside the renderer dirties a cell on an otherwise-quiet row.
    screen.poke(2, 5, 'Z');

    // The frame has not changed. Repaint it.
    renderer.paint(frame);
    renderer.exit();

    const expected = false;
    const actual = screen.visibleLines().some((line) => line.includes('Z'));
    expect(actual).toBe(expected);
  });
});
