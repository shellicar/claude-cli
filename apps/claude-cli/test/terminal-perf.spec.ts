import type { Screen } from '@shellicar/claude-core/screen';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/AppState.js';
import { AttachmentStore } from '../src/AttachmentStore.js';
import { CommandMode } from '../src/CommandMode.js';
import { createEditor, insertChar } from '../src/editor.js';
import { Terminal } from '../src/terminal.js';

function makeTerminal(): Terminal {
  return new Terminal(new AppState(), null, new AttachmentStore(), new CommandMode());
}

describe('Terminal wrapping cache', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('append-then-render at 10K history lines completes in under 1ms', () => {
    const term = makeTerminal();

    // Fill displayBuffer with 10,000 lines (not in alt buffer, so no renders triggered)
    for (let i = 0; i < 10_000; i++) {
      term.info(`history line ${i}`);
    }

    const editor = createEditor();

    // Prime: first render wraps all 10K lines and caches them
    term.renderEditor(editor, '> ');

    // Append 1 line to displayBuffer
    term.info('new line');

    // Measure: second render wraps only the 1 new line
    const start = process.hrtime.bigint();
    term.renderEditor(editor, '> ');
    const end = process.hrtime.bigint();

    const actual = Number(end - start) / 1_000_000;
    const expected = process.env.CI ? 5 : 1;
    expect(actual).toBeLessThan(expected);
  });

  it('resize re-wrap at 10K history lines completes in under 2ms', () => {
    let screenColumns = 192;
    const screen: Screen = {
      get columns() {
        return screenColumns;
      },
      get rows() {
        return 62;
      },
      write(_data: string) {},
      enterAltBuffer() {},
      exitAltBuffer() {},
      onResize() {
        return () => {};
      },
    };

    const term = new Terminal(new AppState(), null, new AttachmentStore(), new CommandMode(), screen);

    // Lines are 175 chars: fits in 192 cols (fast path on append) but exceeds 160 cols (slow path on resize)
    for (let i = 0; i < 10_000; i++) {
      term.info(`${'a'.repeat(165)} ${i.toString().padStart(9, '0')}`);
    }

    const editor = createEditor();

    // Prime: wraps all 10K lines and caches at 192 columns
    term.renderEditor(editor, '> ');

    // Simulate resize to 160 columns
    screenColumns = 160;

    const start = process.hrtime.bigint();
    term.renderEditor(editor, '> ');
    const end = process.hrtime.bigint();

    const actual = Number(end - start) / 1_000_000;
    const expected = process.env.CI ? 20 : 2;
    expect(actual).toBeLessThan(expected);
  });

  it('keystroke-only render at 10K history lines completes in under 1ms', () => {
    const term = makeTerminal();

    // Fill displayBuffer with 10,000 lines
    for (let i = 0; i < 10_000; i++) {
      term.info(`history line ${i}`);
    }

    const editor1 = createEditor();
    const editor2 = insertChar(editor1, 'x');

    // Prime: first render establishes cache baseline
    term.renderEditor(editor1, '> ');

    // Measure: keystroke-only render (editor changed, history unchanged)
    const start = process.hrtime.bigint();
    term.renderEditor(editor2, '> ');
    const end = process.hrtime.bigint();

    const elapsedMs = Number(end - start) / 1_000_000;
    expect(elapsedMs).toBeLessThan(1);
  });
});
