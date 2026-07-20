import { describe, expect, it } from 'vitest';
import { TerminalState } from '../src/model/TerminalState.js';
import { TerminalRenderer } from '../src/view/TerminalRenderer.js';
import { GridScreen } from './GridScreen.js';

/**
 * PR #377 made every paint() repaint every cell unconditionally, specifically so an external mutation
 * (tmux reflowing its own grid on resize or entering copy-mode) would get scrubbed on the next frame
 * even for a row diffToWrites believed unchanged. That cost — a full-grid rewrite on every single
 * render, including the once-a-second clock tick and every mouse-wheel notch — was reverted (see
 * ScreenBuffer.ts's doc comment) once it was confirmed the workaround never actually fixed the tmux
 * ghost-text bug it was written for. Diffing is restored, so this scenario is a known, accepted
 * limitation again: a cell mutated behind the renderer's back on a row this model believes is
 * unchanged survives until something *does* change that row. This test documents that trade-off
 * rather than asserting a guarantee the renderer no longer makes.
 */
describe('renderer diffs against the previous frame', () => {
  it('a repaint of identical content does not scrub a character injected behind its back (accepted limitation, see comment above)', () => {
    const screen = new GridScreen(20, 4);
    const renderer = new TerminalRenderer(screen, new TerminalState());
    renderer.enter();

    const frame = ['line one', 'line two', '', 'line four'];
    renderer.paint(frame);

    // Something outside the renderer dirties a cell on an otherwise-quiet row.
    screen.poke(2, 5, 'Z');

    // The frame has not changed, so a diffing renderer skips this row and the poke survives.
    renderer.paint(frame);
    renderer.exit();

    const expected = true;
    const actual = screen.visibleLines().some((line) => line.includes('Z'));
    expect(actual).toBe(expected);
  });
});
