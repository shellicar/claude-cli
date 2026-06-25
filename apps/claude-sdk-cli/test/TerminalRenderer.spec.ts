import { wrapLine } from '@shellicar/claude-core/reflow';
import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { TerminalState } from '../src/model/TerminalState.js';
import { TerminalRenderer } from '../src/view/TerminalRenderer.js';
import { VirtualScreen } from './VirtualScreen.js';
import type { LastColumnWrap } from './VirtualScreen.js';

// Regression test for the ghost-text defect. paint now addresses each row at an
// absolute cursor position, so a frame renders onto one physical line per row
// regardless of the terminal's last-column wrap semantic. Before the fix, an
// immediate-wrap terminal stranded the line after a full-width row (the ghost):
// the assertions below are red against the old newline-driven paint and green
// against the absolute-addressed one, under both wrap semantics.

const COLS = 12;
const ROWS = 8;

// An unbroken width-1 token longer than COLS. wrapLine splits it into chunks of
// exactly COLS columns, giving a genuine full-width response line produced by
// the real reflow code rather than a hand-rolled string.
const LONG_TOKEN = 'abcdefghijklmnopqrst';
const FULL_WIDTH_LINE = wrapLine(LONG_TOKEN, COLS)[0];

function renderTo(screen: VirtualScreen): TerminalRenderer {
  return new TerminalRenderer(screen, new TerminalState());
}

function newScreen(mode: LastColumnWrap): VirtualScreen {
  return new VirtualScreen({ columns: COLS, rows: ROWS, lastColumnWrap: mode });
}

describe('TerminalRenderer.paint — the full-width response line is genuinely COLS wide', () => {
  it('wrapLine emits a first continuation line of exactly the terminal width', () => {
    const expected = COLS;
    const actual = stringWidth(FULL_WIDTH_LINE);
    expect(actual).toBe(expected);
  });
});

// A static full-width response line with only the input line changing between
// frames. Each row must land on its own physical line in both wrap semantics.
describe('TerminalRenderer.paint — static full-width line, only the input changes', () => {
  function paintTwice(mode: LastColumnWrap): VirtualScreen {
    const screen = newScreen(mode);
    const renderer = renderTo(screen);
    renderer.paint([FULL_WIDTH_LINE, 'mid line', '> in1']);
    renderer.paint([FULL_WIDTH_LINE, 'mid line', '> in2']);
    return screen;
  }

  it('renders the row after the full-width line under deferred wrap', () => {
    const screen = paintTwice('deferred');

    const expected = 'mid line';
    const actual = screen.lineAt(1);
    expect(actual).toBe(expected);
  });

  it('renders the row after the full-width line under immediate wrap', () => {
    // The old defect left this physical line blank (stranded) under immediate
    // wrap. Absolute addressing places the row correctly regardless of semantic.
    const screen = paintTwice('immediate');

    const expected = 'mid line';
    const actual = screen.lineAt(1);
    expect(actual).toBe(expected);
  });
});

// A response line that grows to full width between frames (the streaming shape).
// This is the construction that reproduced the ghost: under immediate wrap the
// grown full-width line pushed the input down a row and stranded a duplicate
// 'tail marker' after it. Absolute addressing removes the drift.
describe('TerminalRenderer.paint — a response line grows to full width between frames', () => {
  const SHORT = 'stream';
  const GROWN = 'streamFULL12'; // exactly COLS wide

  function paintGrowth(mode: LastColumnWrap): VirtualScreen {
    const screen = newScreen(mode);
    const renderer = renderTo(screen);
    renderer.paint(['top resp', SHORT, 'tail marker', '> input']);
    renderer.paint(['top resp', GROWN, 'tail marker', '> input']);
    return screen;
  }

  it('the grown line is exactly the terminal width', () => {
    const expected = COLS;
    const actual = stringWidth(GROWN);
    expect(actual).toBe(expected);
  });

  it('keeps the input on its own line under deferred wrap', () => {
    const screen = paintGrowth('deferred');

    const expected = '> input';
    const actual = screen.lineAt(3);
    expect(actual).toBe(expected);
  });

  it('keeps the input on its own line under immediate wrap', () => {
    // Red against the old paint (the input was pushed down to row 4); green with
    // absolute addressing, which holds the row in place under either semantic.
    const screen = paintGrowth('immediate');

    const expected = '> input';
    const actual = screen.lineAt(3);
    expect(actual).toBe(expected);
  });

  it('leaves nothing stranded below the frame under immediate wrap', () => {
    // The pushed-down input used to land here; after the fix nothing spills past
    // the frame's last row.
    const screen = paintGrowth('immediate');

    const expected = '';
    const actual = screen.lineAt(4);
    expect(actual).toBe(expected);
  });
});
