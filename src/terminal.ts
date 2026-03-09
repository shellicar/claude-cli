import { inspect } from 'node:util';
import { DateTimeFormatter, LocalTime } from '@js-joda/core';
import type { AppState } from './AppState.js';
import type { AttachmentStore } from './AttachmentStore.js';
import type { CommandMode } from './CommandMode.js';
import type { EditorState } from './editor.js';
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
  public constructor(
    private readonly appState: AppState,
    private drowningThreshold: number | null,
    private readonly attachmentStore: AttachmentStore,
    private readonly commandMode: CommandMode,
  ) {}

  public updateConfig(drowningThreshold: number | null): void {
    this.drowningThreshold = drowningThreshold;
  }

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

  private buildStatusLine(columns: number, allowIdle: boolean): { line: string; screenLines: number } | null {
    const b = new StatusLineBuilder();
    const phase = this.appState.phase;
    switch (phase) {
      case 'idle':
        if (!allowIdle) {
          return null;
        }
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
        const remaining = this.appState.promptRemaining;
        const drowning = this.drowningThreshold !== null && remaining !== null && remaining <= this.drowningThreshold;
        const inverse = drowning ? remaining % 2 === 0 : true;
        b.emoji('🔔').text(' ');
        if (remaining !== null) {
          this.buildInverseLine(b, this.appState.promptLabel ?? '', inverse);
        } else {
          const elapsed = this.appState.elapsedSeconds ?? 0;
          this.buildInverseLine(b, `(${elapsed}s) ${this.appState.promptLabel ?? ''}`, true);
        }
        break;
      }
    }
    return { line: b.output, screenLines: b.screenLines(columns) };
  }

  private buildAttachmentLine(columns: number, commandModeActive: boolean): { line: string; screenLines: number } | null {
    const hasAtt = this.attachmentStore.hasAttachments;

    if (!hasAtt && !commandModeActive) {
      return null;
    }

    const b = new StatusLineBuilder();

    if (hasAtt) {
      const store = this.attachmentStore;
      b.emoji('📎');
      b.text(` ${store.attachments.length} attachment${store.attachments.length === 1 ? '' : 's'} `);
      for (let i = 0; i < store.attachments.length; i++) {
        const att = store.attachments[i];
        const sizeKB = Math.ceil(att.sizeBytes / 1024);
        const label = att.kind === 'image' ? 'img' : 'txt';
        const isSelected = commandModeActive && i === store.selectedIndex;
        if (isSelected) {
          b.ansi(inverseOn);
        }
        b.text(`[${i + 1}:${label}:${sizeKB}KB]`);
        if (isSelected) {
          b.ansi(inverseOff);
        }
        if (i < store.attachments.length - 1) {
          b.text(' ');
        }
      }
    }

    if (commandModeActive) {
      if (hasAtt) {
        b.text(' | ');
      }
      b.text('i=image t=text d=delete ');
      if (this.commandMode.previewActive) {
        b.ansi(inverseOn);
      }
      b.text('p=preview');
      if (this.commandMode.previewActive) {
        b.ansi(inverseOff);
      }
      b.text(' \u2190\u2192=select ESC=exit');
    }

    return { line: b.output, screenLines: b.screenLines(columns) };
  }

  private buildPreviewLines(columns: number): { lines: string[]; screenLines: number } | null {
    if (!this.commandMode.previewActive || !this.attachmentStore.hasAttachments) {
      return null;
    }
    const idx = this.attachmentStore.selectedIndex;
    if (idx < 0) {
      return null;
    }
    const att = this.attachmentStore.attachments[idx];
    const maxWidth = columns - 2;
    const lines: string[] = [];

    switch (att.kind) {
      case 'text': {
        const textLines = att.text.split('\n');
        const showLines = textLines.slice(0, 3);
        for (const line of showLines) {
          const truncated = line.length > maxWidth ? `${line.slice(0, maxWidth - 1)}\u2026` : line;
          lines.push(`  ${truncated}`);
        }
        const remaining = textLines.length - showLines.length;
        if (remaining > 0) {
          lines.push(`  \u2026 (${remaining} more line${remaining === 1 ? '' : 's'})`);
        }
        break;
      }
      case 'image': {
        const sizeKB = Math.ceil(att.sizeBytes / 1024);
        const hashPrefix = att.hash.slice(0, 8);
        lines.push(`  image/png ${sizeKB}KB sha256:${hashPrefix}`);
        break;
      }
    }

    let screenLines = 0;
    for (const line of lines) {
      screenLines += Math.max(1, Math.ceil(line.length / columns));
    }
    return { lines, screenLines };
  }

  private buildSticky(): string {
    const columns = process.stdout.columns || 80;
    let output = '';

    const attachmentLine = this.buildAttachmentLine(columns, this.commandMode.active);
    const statusLine = this.buildStatusLine(columns, !attachmentLine);

    let statusScreenLines = 0;
    if (statusLine) {
      output += clearLine + statusLine.line;
      statusScreenLines = statusLine.screenLines;
    }

    // Build attachment line
    let attachmentScreenLines = 0;
    if (attachmentLine) {
      if (statusScreenLines > 0) {
        output += '\n';
      }
      output += clearLine + attachmentLine.line;
      attachmentScreenLines = attachmentLine.screenLines;
    }

    // Build preview lines
    let previewScreenLines = 0;
    const preview = this.buildPreviewLines(columns);
    if (preview) {
      for (const line of preview.lines) {
        output += '\n';
        output += clearLine + line;
      }
      previewScreenLines = preview.screenLines;
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

    this.stickyLineCount = statusScreenLines + attachmentScreenLines + previewScreenLines + editorScreenLines;

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

  public beep(): void {
    process.stdout.write(bel);
  }

  public error(message: string): void {
    this.writeHistory(`\x1b[31mError: ${message}\x1b[0m`);
  }
}
