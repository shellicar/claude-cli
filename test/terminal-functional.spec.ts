import { describe, expect, it } from 'vitest';
import { AppState } from '../src/AppState.js';
import { AttachmentStore } from '../src/AttachmentStore.js';
import { CommandMode } from '../src/CommandMode.js';
import type { Screen } from '../src/Screen.js';
import { Terminal } from '../src/terminal.js';
import { MockScreen } from './MockScreen.js';

function makeTerminal(screen: Screen): Terminal {
  return new Terminal(new AppState(), null, new AttachmentStore(), new CommandMode(), screen);
}

function screenRows(screen: MockScreen): string[] {
  return Array.from({ length: screen.rows }, (_, r) => screen.getRow(r));
}

function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence
  return s.replace(/\u001B\[[^A-Za-z]*[A-Za-z]/g, '');
}

function captureScreen(cols: number, rows: number) {
  let columns = cols;
  const writes: string[] = [];
  const screen: Screen & { setColumns(n: number): void } = {
    get columns() {
      return columns;
    },
    get rows() {
      return rows;
    },
    write(data: string) {
      writes.push(data);
    },
    enterAltBuffer() {},
    exitAltBuffer() {},
    onResize() {
      return () => {};
    },
    setColumns(n: number) {
      columns = n;
      writes.length = 0;
    },
  };
  function textLines() {
    return stripAnsi(writes.join(''))
      .split(/[\r\n]+/)
      .filter((l) => l.length > 0);
  }
  return { screen, textLines };
}

describe('renderZone() functional tests', () => {
  it('history line written via info() appears in rendered output', () => {
    const screen = new MockScreen(80, 10);
    const term = makeTerminal(screen);
    term.enterAltBuffer();

    term.info('hello from history');

    const actual = screenRows(screen).some((r) => r.includes('hello from history'));
    expect(actual).toBe(true);
  });

  it('first history line remains visible after a second line is appended', () => {
    const screen = new MockScreen(80, 10);
    const term = makeTerminal(screen);
    term.enterAltBuffer();

    term.info('first line');
    term.info('second line');

    const actual = screenRows(screen).some((r) => r.includes('first line'));
    expect(actual).toBe(true);
  });

  it('newly appended history line appears in rendered output', () => {
    const screen = new MockScreen(80, 10);
    const term = makeTerminal(screen);
    term.enterAltBuffer();

    term.info('first line');
    term.info('second line');

    const actual = screenRows(screen).some((r) => r.includes('second line'));
    expect(actual).toBe(true);
  });

  it('long line is split into multiple rows when it exceeds column width', () => {
    const { screen, textLines } = captureScreen(10, 20);
    const term = makeTerminal(screen);
    term.enterAltBuffer();

    term.info('a'.repeat(25));

    const aLines = textLines().filter((l) => /^a+$/.test(l));
    const actual = aLines.length;
    expect(actual).toBeGreaterThan(1);
  });

  it('wrapped rows do not exceed column width', () => {
    const { screen, textLines } = captureScreen(10, 20);
    const term = makeTerminal(screen);
    term.enterAltBuffer();

    term.info('a'.repeat(25));

    const aLines = textLines().filter((l) => /^a+$/.test(l));
    const actual = Math.max(...aLines.map((l) => l.length));
    const expected = 10;
    expect(actual).toBeLessThanOrEqual(expected);
  });

  it('after column resize, long line is re-wrapped to fit new width', () => {
    const { screen, textLines } = captureScreen(10, 20);
    const term = makeTerminal(screen);
    term.enterAltBuffer();

    term.info('a'.repeat(15));

    screen.setColumns(25);
    term.refresh();

    const aLines = textLines().filter((l) => /^a+$/.test(l));
    const actual = aLines.length;
    const expected = 1;
    expect(actual).toBe(expected);
  });
});
