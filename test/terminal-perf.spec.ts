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
