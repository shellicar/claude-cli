import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AppState } from '../src/AppState.js';
import { AttachmentStore } from '../src/AttachmentStore.js';
import { CommandMode } from '../src/CommandMode.js';
import { Terminal } from '../src/terminal.js';

function makeTerminal(): Terminal {
  return new Terminal(new AppState(), null, new AttachmentStore(), new CommandMode());
}

describe('Terminal.writeHistory newline splitting', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('single-line input produces one displayBuffer entry', () => {
    const term = makeTerminal();
    term.info('hello');
    expect(term.testDisplayBuffer).toEqual(['hello']);
  });

  it('multi-line input produces separate displayBuffer entries per line', () => {
    const term = makeTerminal();
    term.info('line one\nline two');
    expect(term.testDisplayBuffer).toEqual(['line one', 'line two']);
  });

  it('three-line input produces three displayBuffer entries', () => {
    const term = makeTerminal();
    term.info('a\nb\nc');
    expect(term.testDisplayBuffer).toEqual(['a', 'b', 'c']);
  });

  it('consecutive newlines preserve empty entries', () => {
    const term = makeTerminal();
    term.info('before\n\nafter');
    expect(term.testDisplayBuffer).toEqual(['before', '', 'after']);
  });

  it('trailing newline produces a trailing empty entry', () => {
    const term = makeTerminal();
    term.info('line\n');
    expect(term.testDisplayBuffer).toEqual(['line', '']);
  });

  it('multiple info calls accumulate correctly', () => {
    const term = makeTerminal();
    term.info('first');
    term.info('second\nthird');
    expect(term.testDisplayBuffer).toEqual(['first', 'second', 'third']);
  });
});
