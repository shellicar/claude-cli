import { inspect } from 'node:util';
import { DateTimeFormatter, LocalTime } from '@js-joda/core';
import type { AppState } from './AppState.js';
import type { EditorState } from './editor.js';
import type { ImageStoreState } from './ImageStore.js';
import { type EditorRender, prepareEditor } from './renderer.js';
import { StatusLineBuilder } from './StatusLineBuilder.js';

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
const bel = '\x07';

export class Terminal {
  private editorContent: EditorRender = { lines: [], cursorRow: 0, cursorCol: 0 };
  private stickyLineCount = 0;
  private cursorLinesFromBottom = 0;
  private cursorHidden = false;
  private _paused = false;
  private pauseBuffer: string[] = [];
  private imageStore: ImageStoreState | undefined;
  private commandModeActive = false;

  public constructor(
    private readonly appState: AppState,
    private readonly drowningThreshold: number | null,
  ) {}

  public get paused(): boolean {
    return this._paused;
  }

  public set paused(value: boolean) {
    this._paused = value;
    if (!value) {
      this.flushPauseBuffer();
    }
  }

  private flushPauseBuffer(): void {
    if (this.pauseBuffer.length === 0) {
      return;
    }
    const lines = this.pauseBuffer.splice(0);
    for (const line of lines) {
      this.writeHistory(line);
    }
  }

  private timestamp(): string {
    return LocalTime.now().format(TIME_FORMAT);
  }

  private formatLogLine(message: string, ...args: unknown[]): string {
    let line = `${resetStyle}[${this.timestamp()}] ${message}`;
    for (const a of args) {
      line += ' ';
      line += typeof a === 'string' ? a : inspect(a, { depth: null, colors: true, breakLength: Infinity, compact: true });
    }
    return line;
  }

  private buildLogLine(b: StatusLineBuilder, message: string): void {
    b.ansi(resetStyle);
    const ts = this.timestamp();
    b.text(`[${ts}] ${message}`);
  }

  private buildInverseLine(b: StatusLineBuilder, message: string, inverse: boolean): void {
    b.ansi(resetStyle);
    if (inverse) {
      b.ansi(inverseOn);
    }
    const ts = this.timestamp();
    b.text(`[${ts}] ${message}`);
    if (inverse) {
      b.ansi(inverseOff);
    }
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

  private buildStatusLine(columns: number): { line: string; screenLines: number } {
    const b = new StatusLineBuilder();
    const phase = this.appState.phase;
    switch (phase) {
      case 'idle':
        b.emoji('⚡');
        break;
      case 'sending': {
        const elapsed = this.appState.elapsedSeconds ?? 0;
        b.emoji('⏳').text(' ');
        this.buildLogLine(b, `Waiting for ${elapsed}s...`);
        break;
      }
      case 'thinking': {
        const elapsed = this.appState.elapsedSeconds ?? 0;
        b.emoji('⚡').text(' ');
        this.buildLogLine(b, `Thinking for ${elapsed}s...`);
        break;
      }
      case 'prompting': {
        const remaining = this.appState.promptRemaining;
        const drowning = this.drowningThreshold !== null && remaining !== null && remaining <= this.drowningThreshold;
        const inverse = drowning ? remaining % 2 === 0 : true;
        b.emoji('🔔').text(' ');
        this.buildInverseLine(b, this.appState.promptLabel ?? '', inverse);
        break;
      }
      case 'asking': {
        const elapsed = this.appState.elapsedSeconds ?? 0;
        b.emoji('🔔').text(' ');
        this.buildInverseLine(b, `(${elapsed}s) ${this.appState.promptLabel ?? ''}`, true);
        break;
      }
    }
    return { line: b.output, screenLines: b.screenLines(columns) };
  }

  private buildImageLine(columns: number, commandModeActive: boolean): { line: string; screenLines: number } | null {
    if (!this.imageStore || this.imageStore.images.length === 0) {
      return null;
    }
    const b = new StatusLineBuilder();
    b.emoji('📎');
    b.text(` ${this.imageStore.images.length} image${this.imageStore.images.length === 1 ? '' : 's'} `);
    for (let i = 0; i < this.imageStore.images.length; i++) {
      const sizeKB = Math.ceil(this.imageStore.images[i].data.length / 1024);
      const isSelected = i === this.imageStore.selectedIndex;
      if (isSelected) {
        b.ansi(inverseOn);
      }
      b.text(`[${i + 1}:${sizeKB}KB]`);
      if (isSelected) {
        b.ansi(inverseOff);
      }
      if (i < this.imageStore.images.length - 1) {
        b.text(' ');
      }
    }
    if (commandModeActive) {
      b.text(' | i=paste d=delete \u2190\u2192=select ESC=exit');
    }
    return { line: b.output, screenLines: b.screenLines(columns) };
  }

  private buildSticky(): string {
    const columns = process.stdout.columns || 80;
    let output = '';

    // Build status line (always present to avoid history jumping)
    const { line, screenLines } = this.buildStatusLine(columns);
    output += clearLine + line;

    // Build image line (between status and editor)
    let imageScreenLines = 0;
    const imageLine = this.buildImageLine(columns, this.commandModeActive);
    if (imageLine) {
      output += '\n';
      output += clearLine + imageLine.line;
      imageScreenLines = imageLine.screenLines;
    }

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

    this.stickyLineCount = screenLines + imageScreenLines + editorScreenLines;

    return output;
  }

  private writeHistory(line: string): void {
    if (this._paused) {
      this.pauseBuffer.push(line);
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

  public renderEditor(editor: EditorState, prompt: string, hideCursor = false, imageStore?: ImageStoreState, commandModeActive = false): void {
    if (this.paused) {
      return;
    }
    this.imageStore = imageStore;
    this.commandModeActive = commandModeActive;
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

  public beep(): void {
    process.stdout.write(bel);
  }

  public error(message: string): void {
    this.writeHistory(`\x1b[31mError: ${message}\x1b[0m`);
  }
}
