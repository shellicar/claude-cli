import { describe, expect, it } from 'vitest';
import { CommandModeState } from '../src/model/CommandModeState.js';
import { renderCommandMode } from '../src/view/renderCommandMode.js';

const COLS = 120;
const MAX_TEXT_LINES = 8;
const MAX_ROWS = 12;

function emptyState(): CommandModeState {
  return new CommandModeState();
}

function stateWithText(text = 'hello world'): CommandModeState {
  const state = new CommandModeState();
  state.addText(text);
  return state;
}

function stateInCommandMode(): CommandModeState {
  const state = new CommandModeState();
  state.toggleCommandMode();
  return state;
}

function stateInCommandModeWithText(text = 'hello world'): CommandModeState {
  const state = new CommandModeState();
  state.addText(text);
  state.toggleCommandMode();
  return state;
}

// ---------------------------------------------------------------------------
// No command mode, no attachments
// ---------------------------------------------------------------------------

describe('renderCommandMode — empty state', () => {
  it('commandRow is empty when no command mode and no attachments', () => {
    const expected = '';
    const actual = renderCommandMode(emptyState(), COLS, MAX_TEXT_LINES, MAX_ROWS).commandRow;
    expect(actual).toBe(expected);
  });

  it('previewRows is empty when no command mode and no attachments', () => {
    const expected = 0;
    const actual = renderCommandMode(emptyState(), COLS, MAX_TEXT_LINES, MAX_ROWS).previewRows.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Attachments visible without command mode
// ---------------------------------------------------------------------------

describe('renderCommandMode — attachment chips without command mode', () => {
  it('commandRow is non-empty when attachments exist even without command mode', () => {
    const expected = true;
    const actual = renderCommandMode(stateWithText(), COLS, MAX_TEXT_LINES, MAX_ROWS).commandRow.length > 0;
    expect(actual).toBe(expected);
  });

  it('commandRow does not include cmd hint when not in command mode', () => {
    const expected = false;
    const actual = renderCommandMode(stateWithText(), COLS, MAX_TEXT_LINES, MAX_ROWS).commandRow.includes('cmd');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Command mode active
// ---------------------------------------------------------------------------

describe('renderCommandMode — command mode active', () => {
  it('commandRow includes "cmd" when in command mode', () => {
    const expected = true;
    const actual = renderCommandMode(stateInCommandMode(), COLS, MAX_TEXT_LINES, MAX_ROWS).commandRow.includes('cmd');
    expect(actual).toBe(expected);
  });

  it('commandRow includes paste hint when in command mode with no attachments', () => {
    const expected = true;
    const actual = renderCommandMode(stateInCommandMode(), COLS, MAX_TEXT_LINES, MAX_ROWS).commandRow.includes('paste');
    expect(actual).toBe(expected);
  });

  it('commandRow includes select hint when in command mode with attachments', () => {
    const expected = true;
    const actual = renderCommandMode(stateInCommandModeWithText(), COLS, MAX_TEXT_LINES, MAX_ROWS).commandRow.includes('select');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Attachment chip content
// ---------------------------------------------------------------------------

describe('renderCommandMode — text attachment chip', () => {
  it('commandRow includes [txt ...] chip for text attachments', () => {
    const expected = true;
    const actual = renderCommandMode(stateWithText(), COLS, MAX_TEXT_LINES, MAX_ROWS).commandRow.includes('[txt ');
    expect(actual).toBe(expected);
  });
});

describe('renderCommandMode — file attachment chip', () => {
  it('commandRow includes filename in chip for file attachments', () => {
    const state = new CommandModeState();
    state.addFile('/tmp/myfile.txt', 'file', 512);
    const expected = true;
    const actual = renderCommandMode(state, COLS, MAX_TEXT_LINES, MAX_ROWS).commandRow.includes('myfile.txt');
    expect(actual).toBe(expected);
  });

  it('commandRow shows trailing slash for directory attachments', () => {
    const state = new CommandModeState();
    state.addFile('/tmp/mydir', 'dir');
    const expected = true;
    const actual = renderCommandMode(state, COLS, MAX_TEXT_LINES, MAX_ROWS).commandRow.includes('mydir/');
    expect(actual).toBe(expected);
  });

  it('commandRow shows ? for missing file attachments', () => {
    const state = new CommandModeState();
    state.addFile('/tmp/missing.txt', 'missing');
    const expected = true;
    const actual = renderCommandMode(state, COLS, MAX_TEXT_LINES, MAX_ROWS).commandRow.includes('?');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Preview rows
// ---------------------------------------------------------------------------

describe('renderCommandMode — previewRows', () => {
  it('previewRows is empty when command mode is off', () => {
    const state = stateWithText('line one\nline two');
    state.togglePreview(); // no selection, no-op initially — need to add text first... actually addText selects it
    // Re-create: addText selects the item, but commandMode is off
    const expected = 0;
    const actual = renderCommandMode(state, COLS, MAX_TEXT_LINES, MAX_ROWS).previewRows.length;
    expect(actual).toBe(expected);
  });

  it('previewRows is empty when previewMode is off even in command mode', () => {
    const state = stateInCommandModeWithText('line one\nline two');
    // previewMode is still false
    const expected = 0;
    const actual = renderCommandMode(state, COLS, MAX_TEXT_LINES, MAX_ROWS).previewRows.length;
    expect(actual).toBe(expected);
  });

  it('previewRows is non-empty when both commandMode and previewMode are on', () => {
    const state = stateInCommandModeWithText('line one\nline two');
    state.togglePreview();
    const expected = true;
    const actual = renderCommandMode(state, COLS, MAX_TEXT_LINES, MAX_ROWS).previewRows.length > 0;
    expect(actual).toBe(expected);
  });

  it('previewRows contains text attachment content', () => {
    const state = stateInCommandModeWithText('unique-sentinel-value');
    state.togglePreview();
    const rows = renderCommandMode(state, COLS, MAX_TEXT_LINES, MAX_ROWS).previewRows;
    const expected = true;
    const actual = rows.some((r) => r.includes('unique-sentinel-value'));
    expect(actual).toBe(expected);
  });

  it('previewRows shows path for file attachments', () => {
    const state = new CommandModeState();
    state.addFile('/tmp/special-path', 'file', 100);
    state.toggleCommandMode();
    state.togglePreview();
    const rows = renderCommandMode(state, COLS, MAX_TEXT_LINES, MAX_ROWS).previewRows;
    const expected = true;
    const actual = rows.some((r) => r.includes('special-path'));
    expect(actual).toBe(expected);
  });

  it('previewRows is capped at maxRows', () => {
    const manyLines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const state = stateInCommandModeWithText(manyLines);
    state.togglePreview();
    const cap = 3;
    const rows = renderCommandMode(state, COLS, MAX_TEXT_LINES, cap).previewRows;
    const expected = true;
    const actual = rows.length <= cap;
    expect(actual).toBe(expected);
  });

  it('previewRows text content is limited by maxTextLines', () => {
    const manyLines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const state = stateInCommandModeWithText(manyLines);
    state.togglePreview();
    const maxText = 4;
    const rows = renderCommandMode(state, COLS, maxText, MAX_ROWS).previewRows;
    const expected = true;
    // Should see the "more lines" ellipsis
    const actual = rows.some((r) => r.includes('more lines'));
    expect(actual).toBe(expected);
  });
});
