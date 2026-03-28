import { inspect } from 'node:util';
import { DateTimeFormatter, LocalTime } from '@js-joda/core';
import stringWidth from 'string-width';
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
  private scrollOffset = 0;
  private _paused = false;
  private pauseBuffer: string[] = [];
  private questionLines: string[] = [];
  public sessionId: string | undefined;
  public modelOverride: string | undefined;

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
        if (this.modelOverride) {
          b.text(` \x1b[33mmodel: ${this.modelOverride}*\x1b[0m`);
        }
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
      if (this.commandMode.context === 'session') {
        const id = this.sessionId ?? 'none';
        b.text(`session: ${id} | c=clear /=back`);
      } else {
        b.text('i=image t=text d=delete ');
        if (this.commandMode.previewActive) {
          b.ansi(inverseOn);
        }
        b.text('p=preview');
        if (this.commandMode.previewActive) {
          b.ansi(inverseOff);
        }
        b.text(' \u2190\u2192=select s=session ESC=exit');
      }
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

    // Build question lines first (instruction + options), then status at bottom
    let questionScreenLines = 0;
    let hasOutput = false;
    for (const line of this.questionLines) {
      if (hasOutput) {
        output += '\n';
      }
      output += clearLine + line;
      questionScreenLines += Math.max(1, Math.ceil(stringWidth(line) / columns));
      hasOutput = true;
    }

    let statusScreenLines = 0;
    if (statusLine) {
      if (hasOutput) {
        output += '\n';
      }
      output += clearLine + statusLine.line;
      statusScreenLines = statusLine.screenLines;
      hasOutput = true;
    }

    // Build attachment line
    let attachmentScreenLines = 0;
    if (attachmentLine) {
      if (hasOutput) {
        output += '\n';
      }
      output += clearLine + attachmentLine.line;
      attachmentScreenLines = attachmentLine.screenLines;
      hasOutput = true;
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

    // Compute available rows for the editor (terminal height minus non-editor components)
    const terminalRows = process.stdout.rows || 24;
    const nonEditorRows = statusScreenLines + attachmentScreenLines + previewScreenLines + questionScreenLines;
    const availableRows = Math.max(1, terminalRows - nonEditorRows);

    // Build a map from logical line index to its starting terminal row within the editor.
    const lineStartRow: number[] = [];
    let nextStartRow = 0;
    for (let i = 0; i < this.editorContent.lines.length; i++) {
      lineStartRow.push(nextStartRow);
      nextStartRow += Math.max(1, Math.ceil(stringWidth(this.editorContent.lines[i]) / columns));
    }

    // Adjust scrollOffset so the cursor row stays within the visible window.
    const cursorRow = this.editorContent.cursorRow;
    if (cursorRow < this.scrollOffset) {
      this.scrollOffset = cursorRow;
    } else if (cursorRow >= this.scrollOffset + availableRows) {
      this.scrollOffset = cursorRow - availableRows + 1;
    }

    // Cap scrollOffset so content is never scrolled past the end (no empty rows below content).
    const maxScrollOffset = Math.max(0, nextStartRow - availableRows);
    this.scrollOffset = Math.min(this.scrollOffset, maxScrollOffset);

    // Snap scrollOffset backward to the nearest logical line boundary so we
    // never start rendering mid-way through a wrapped logical line.
    let snapped = 0;
    for (let i = 0; i < lineStartRow.length; i++) {
      if (lineStartRow[i] <= this.scrollOffset) {
        snapped = lineStartRow[i];
      } else {
        break;
      }
    }
    this.scrollOffset = snapped;

    // Render logical lines whose start terminal row falls within the visible window.
    let editorScreenLines = 0;
    for (let i = 0; i < this.editorContent.lines.length; i++) {
      const start = lineStartRow[i];
      const rows = Math.max(1, Math.ceil(stringWidth(this.editorContent.lines[i]) / columns));
      if (start >= this.scrollOffset && start < this.scrollOffset + availableRows) {
        output += '\n';
        output += clearLine + this.editorContent.lines[i];
        // Count how many of this line's terminal rows actually fit in the window.
        const visibleRows = Math.min(rows, this.scrollOffset + availableRows - start);
        editorScreenLines += visibleRows;
      }
    }

    // Clear any leftover lines from previous render
    output += clearDown;

    // Position cursor within the visible editor window.
    // cursorRow is the absolute terminal row within the full editor. Subtract
    // scrollOffset to get the row within the rendered window.
    const visibleCursorRow = cursorRow - this.scrollOffset;
    this.cursorLinesFromBottom = editorScreenLines - visibleCursorRow - 1;
    if (this.cursorLinesFromBottom > 0) {
      output += cursorUp(this.cursorLinesFromBottom);
    }
    output += cursorTo(this.editorContent.cursorCol % columns);
    output += this.cursorHidden ? hideCursorSeq : showCursor;

    this.stickyLineCount = statusScreenLines + attachmentScreenLines + previewScreenLines + questionScreenLines + editorScreenLines;

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

  public setQuestionLines(lines: string[]): void {
    this.questionLines = lines;
    this.refresh();
  }

  public clearQuestionLines(): void {
    this.questionLines = [];
    this.refresh();
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
