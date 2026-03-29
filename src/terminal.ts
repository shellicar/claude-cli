import { inspect } from 'node:util';
import { DateTimeFormatter, LocalTime } from '@js-joda/core';
import stringWidth from 'string-width';
import type { AppState } from './AppState.js';
import type { AttachmentStore } from './AttachmentStore.js';
import type { CommandMode } from './CommandMode.js';
import type { EditorState } from './editor.js';
import type { BuiltComponent, LayoutInput } from './Layout.js';
import { layout } from './Layout.js';
import { type EditorRender, prepareEditor } from './renderer.js';
import type { Screen } from './Screen.js';
import { StdoutScreen } from './Screen.js';
import { StatusLineBuilder } from './StatusLineBuilder.js';
import { Renderer } from './TerminalRenderer.js';
import { Viewport } from './Viewport.js';

const TIME_FORMAT = DateTimeFormatter.ofPattern('HH:mm:ss.SSS');

const ESC = '\x1B[';
const hideCursorSeq = `${ESC}?25l`;
const resetStyle = `${ESC}0m`;
const inverseOn = `${ESC}7m`;
const inverseOff = `${ESC}27m`;
const bel = '\x07';

export class Terminal {
  private editorContent: EditorRender = { lines: [], cursorRow: 0, cursorCol: 0 };
  private cursorHidden = false;
  private _paused = false;
  private pauseBuffer: string[] = [];
  private questionLines: string[] = [];
  private readonly screen: Screen;
  private readonly viewport: Viewport;
  private readonly renderer: Renderer;
  public sessionId: string | undefined;
  public modelOverride: string | undefined;

  public constructor(
    private readonly appState: AppState,
    private drowningThreshold: number | null,
    private readonly attachmentStore: AttachmentStore,
    private readonly commandMode: CommandMode,
  ) {
    this.screen = new StdoutScreen();
    this.viewport = new Viewport();
    this.renderer = new Renderer(this.screen);
  }

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

  private buildLayoutInput(columns: number): LayoutInput {
    const attachmentResult = this.buildAttachmentLine(columns, this.commandMode.active);
    const statusResult = this.buildStatusLine(columns, !attachmentResult);
    const previewResult = this.buildPreviewLines(columns);

    const statusComp: BuiltComponent | null = statusResult ? { rows: [statusResult.line], height: statusResult.screenLines } : null;
    let attachComp: BuiltComponent | null = attachmentResult ? { rows: [attachmentResult.line], height: attachmentResult.screenLines } : null;
    let previewComp: BuiltComponent | null = previewResult ? { rows: previewResult.lines, height: previewResult.screenLines } : null;

    let questionHeight = 0;
    for (const line of this.questionLines) {
      questionHeight += Math.max(1, Math.ceil(stringWidth(line) / columns));
    }
    let questionComp: BuiltComponent | null = this.questionLines.length > 0 ? { rows: this.questionLines, height: questionHeight } : null;

    const terminalRows = this.screen.rows;
    const minEditorRows = 1;
    const maxNonEditor = terminalRows - minEditorRows;
    let nonEditorRows = (statusComp?.height ?? 0) + (attachComp?.height ?? 0) + (previewComp?.height ?? 0) + (questionComp?.height ?? 0);

    if (nonEditorRows > maxNonEditor) {
      nonEditorRows -= previewComp?.height ?? 0;
      previewComp = null;
    }
    if (nonEditorRows > maxNonEditor) {
      nonEditorRows -= attachComp?.height ?? 0;
      attachComp = null;
    }
    if (nonEditorRows > maxNonEditor) {
      questionComp = null;
    }

    return {
      editor: this.editorContent,
      status: statusComp,
      attachments: attachComp,
      preview: previewComp,
      question: questionComp,
      columns,
    };
  }

  private renderZone(): void {
    const columns = this.screen.columns;
    const rows = this.screen.rows;
    const input = this.buildLayoutInput(columns);
    const result = layout(input);
    const frame = this.viewport.resolve(result.buffer, rows, result.cursorRow, result.cursorCol);
    this.renderer.render(frame);
    if (this.cursorHidden) {
      this.screen.write(hideCursorSeq);
    }
  }

  private writeHistory(line: string): void {
    if (this._paused) {
      this.pauseBuffer.push(line);
      return;
    }
    // writeHistoryLine moves to zone top, writes the line, and resets cursor
    // tracking. renderZone then re-renders with the CURRENT layout state so the
    // zone reflects any changes that happened before this write (e.g. question
    // cleared by clearQuestionLines before the history write).
    this.renderer.writeHistoryLine(line);
    this.renderZone();
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
    this.renderZone();
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
    this.editorContent = prepareEditor(editor, prompt);
    this.cursorHidden = hideCursor;
    this.renderZone();
  }

  public write(data: string): void {
    if (this.paused) {
      return;
    }
    this.screen.write(data);
  }

  public beep(): void {
    this.screen.write(bel);
  }

  public error(message: string): void {
    this.writeHistory(`\x1b[31mError: ${message}\x1b[0m`);
  }
}
