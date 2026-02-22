import { inspect } from 'node:util';
import { DateTimeFormatter, LocalTime } from '@js-joda/core';
import type { AppState } from './AppState.js';
import type { EditorState } from './editor.js';
import { type EditorRender, prepareEditor } from './renderer.js';

const TIME_FORMAT = DateTimeFormatter.ofPattern('HH:mm:ss.SSS');

const ESC = '\x1B[';
const cursorUp = (n: number) => (n > 0 ? `${ESC}${n}A` : '');
const cursorDown = (n: number) => (n > 0 ? `${ESC}${n}B` : '');
const cursorTo = (col: number) => `${ESC}${col + 1}G`;
const clearLine = `${ESC}2K`;
const clearDown = `${ESC}J`;
const showCursor = `${ESC}?25h`;
const hideCursorSeq = `${ESC}?25l`;
const resetStyle = `${ESC}0m`;
const inverseOn = `${ESC}7m`;
const inverseOff = `${ESC}27m`;

export class Terminal {
  private editorContent: EditorRender = { lines: [], cursorRow: 0, cursorCol: 0 };
  private stickyLineCount = 0;
  private cursorLinesFromBottom = 0;
  private cursorHidden = false;
  public paused = false;

  public constructor(private readonly appState: AppState) {}

  private timestamp(): string {
    return LocalTime.now().format(TIME_FORMAT);
  }

  private formatLogLine(message: string, ...args: unknown[]): string;
  private formatLogLine(message: string, options: { inverse: boolean }): string;
  private formatLogLine(message: string, ...args: unknown[]): string {
    const inverse = args.length === 1 && typeof args[0] === 'object' && args[0] !== null && 'inverse' in args[0] && (args[0] as { inverse: boolean }).inverse;
    const reset = inverse ? resetStyle + inverseOn : resetStyle;
    let line = `${reset}[${this.timestamp()}] ${message}`;
    if (!inverse && args.length > 0) {
      for (const a of args) {
        line += ' ';
        line += typeof a === 'string' ? a : inspect(a, { depth: null, colors: true, breakLength: Infinity, compact: true });
      }
    }
    if (inverse) {
      line += inverseOff;
    }
    return line;
  }

  private clearStickyZone(): string {
    if (this.stickyLineCount === 0) {
      return '';
    }
    let output = '';
    // Move cursor to bottom of sticky zone first, then up to top
    output += cursorDown(this.cursorLinesFromBottom);
    output += cursorUp(this.stickyLineCount - 1);
    output += '\r';
    output += clearDown;
    return output;
  }

  private buildStatusLine(): string {
    const phase = this.appState.phase;
    switch (phase) {
      case 'idle':
        return '⚡';
      case 'sending': {
        const elapsed = this.appState.elapsedSeconds ?? 0;
        return '⏳ ' + this.formatLogLine(`Waiting for ${elapsed}s...`);
      }
      case 'thinking': {
        const elapsed = this.appState.elapsedSeconds ?? 0;
        return '⚡ ' + this.formatLogLine(`Thinking for ${elapsed}s...`);
      }
      case 'prompting':
        return '🔔 ' + this.formatLogLine(this.appState.promptLabel ?? '', { inverse: true });
      case 'asking': {
        const elapsed = this.appState.elapsedSeconds ?? 0;
        return '🔔 ' + this.formatLogLine(`(${elapsed}s) ${this.appState.promptLabel ?? ''}`, { inverse: true });
      }
    }
  }

  private buildSticky(): string {
    const columns = process.stdout.columns || 80;
    let output = '';

    // Build status line (always present to avoid history jumping)
    const statusScreenLines = 1;
    output += clearLine + this.buildStatusLine();

    // Build editor lines
    let editorScreenLines = 0;
    for (let i = 0; i < this.editorContent.lines.length; i++) {
      output += '\n';
      output += clearLine + this.editorContent.lines[i];
      editorScreenLines += Math.max(1, Math.ceil(this.editorContent.lines[i].length / columns));
    }

    // Clear any leftover lines from previous render
    output += clearDown;

    // Position cursor within editor
    this.cursorLinesFromBottom = 0;
    for (let i = this.editorContent.lines.length - 1; i > this.editorContent.cursorRow; i--) {
      this.cursorLinesFromBottom += Math.max(1, Math.ceil(this.editorContent.lines[i].length / columns));
    }
    if (this.cursorLinesFromBottom > 0) {
      output += cursorUp(this.cursorLinesFromBottom);
    }
    output += cursorTo(this.editorContent.cursorCol);
    output += this.cursorHidden ? hideCursorSeq : showCursor;

    this.stickyLineCount = statusScreenLines + editorScreenLines;

    return output;
  }

  private writeHistory(line: string): void {
    if (this.paused) {
      return;
    }
    let output = '';
    output += this.clearStickyZone();
    output += line;
    output += '\n';
    this.stickyLineCount = 0;
    output += this.buildSticky();
    process.stdout.write(output);
  }

  /** Call when AppState changes to refresh the sticky zone */
  public refresh(): void {
    if (this.paused) {
      return;
    }
    let output = '';
    output += this.clearStickyZone();
    this.stickyLineCount = 0;
    output += this.buildSticky();
    process.stdout.write(output);
  }

  public log(message: string, ...args: unknown[]): void {
    const line = this.formatLogLine(message, ...args);
    this.writeHistory(line);
  }

  public info(message: string): void {
    this.writeHistory(message);
  }

  public renderEditor(editor: EditorState, prompt: string, hideCursor = false): void {
    if (this.paused) {
      return;
    }
    let output = '';
    output += this.clearStickyZone();
    this.editorContent = prepareEditor(editor, prompt);
    this.cursorHidden = hideCursor;
    this.stickyLineCount = 0;
    output += this.buildSticky();
    process.stdout.write(output);
  }

  public write(data: string): void {
    if (this.paused) {
      return;
    }
    process.stdout.write(data);
  }

  public error(message: string): void {
    process.stderr.write(`Error: ${message}\n`);
  }
}
