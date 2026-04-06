import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { clearDown, clearLine, cursorAt, DIM, hideCursor, INVERSE_OFF, INVERSE_ON, RESET, syncEnd, syncStart } from '@shellicar/claude-core/ansi';
import type { KeyAction } from '@shellicar/claude-core/input';
import { wrapLine } from '@shellicar/claude-core/reflow';
import { sanitiseLoneSurrogates } from '@shellicar/claude-core/sanitise';
import type { Screen } from '@shellicar/claude-core/screen';
import { StdoutScreen } from '@shellicar/claude-core/screen';
import { StatusLineBuilder } from '@shellicar/claude-core/status-line';
import type { SdkMessageUsage } from '@shellicar/claude-sdk';
import { AttachmentStore } from './AttachmentStore.js';
import type { Block, BlockType } from './ConversationState.js';
import { ConversationState } from './ConversationState.js';
import { readClipboardPath, readClipboardText } from './clipboard.js';
import { EditorState } from './EditorState.js';
import { logger } from './logger.js';
import { buildDivider, renderBlocksToString, renderConversation } from './renderConversation.js';
import { renderEditor } from './renderEditor.js';
import { renderStatus } from './renderStatus.js';
import { StatusState } from './StatusState.js';

export type PendingTool = {
  requestId: string;
  name: string;
  input: Record<string, unknown>;
};

type Mode = 'editor' | 'streaming';

// Indentation used for tool expansion and attachment preview rows.
// renderConversation.ts uses the same value for block content lines.
const CONTENT_INDENT = '   ';

/** Returns true if the string looks like a deliberate filesystem path (for missing-file chips). */
function isLikelyPath(s: string): boolean {
  if (!s || s.length > 1024) {
    return false;
  }
  if (/[\n\r]/.test(s)) {
    return false;
  }
  return s.startsWith('/') || s.startsWith('~/') || s === '~' || s.startsWith('./') || s.startsWith('../');
}

export class AppLayout implements Disposable {
  readonly #screen: Screen;
  readonly #cleanupResize: () => void;

  #mode: Mode = 'editor';
  #conversationState = new ConversationState();
  #editorState = new EditorState();
  #renderPending = false;

  #pendingTools: PendingTool[] = [];
  #selectedTool = 0;
  #toolExpanded = false;

  #commandMode = false;
  #previewMode = false;
  #attachments = new AttachmentStore();

  #editorResolve: ((value: string) => void) | null = null;
  #pendingApprovals: Array<(approved: boolean) => void> = [];
  #cancelFn: (() => void) | null = null;

  #statusState = new StatusState();

  public constructor() {
    this.#screen = new StdoutScreen();
    this.#cleanupResize = this.#screen.onResize(() => this.render());
  }

  public [Symbol.dispose](): void {
    this.exit();
  }

  public enter(): void {
    this.#screen.enterAltBuffer();
    this.render();
  }

  /** Push a sealed meta block at startup so version info appears before the first prompt. */
  public showStartupBanner(text: string): void {
    this.#conversationState.addBlocks([{ type: 'meta', content: text }]);
    this.render();
  }

  /** Push pre-built sealed blocks (e.g. from history replay) and render once. */
  public addHistoryBlocks(blocks: Block[]): void {
    this.#conversationState.addBlocks(blocks);
    this.render();
  }

  public exit(): void {
    this.#cleanupResize();
    this.#screen.exitAltBuffer();
  }

  /** Transition to streaming mode. Seals the prompt as a block; active block is created on first content. */
  public startStreaming(prompt: string): void {
    this.#conversationState.addBlocks([{ type: 'prompt', content: prompt }]);
    this.#mode = 'streaming';
    this.#flushToScroll();
    this.render();
  }

  /** Transition to a new block type. Seals the current block (if it has content) and opens a fresh one.
   * Consecutive same-type blocks are merged visually by the renderer (no header or gap between them),
   * so there is nothing special to do here — every call produces its own block. */
  public transitionBlock(type: BlockType): void {
    const result = this.#conversationState.transitionBlock(type);
    if (result.noop) {
      logger.debug('transitionBlock_noop', { type, totalSealed: this.#conversationState.sealedBlocks.length });
      return;
    }
    logger.debug('transitionBlock', { from: result.from, to: type, sealed: result.sealed, totalSealed: this.#conversationState.sealedBlocks.length });
    this.render();
  }

  /** Append a chunk of text to the active block. */
  public appendStreaming(text: string): void {
    if (this.#conversationState.activeBlock) {
      this.#conversationState.appendToActive(sanitiseLoneSurrogates(text));
      this.render();
    }
  }

  /** Seal the completed response block and return to editor mode. */
  public completeStreaming(): void {
    this.#conversationState.completeActive();
    this.#pendingTools = [];
    this.#mode = 'editor';
    this.#commandMode = false;
    this.#previewMode = false;
    this.#attachments.clear();
    this.#editorState.reset();
    this.#flushToScroll();
    this.render();
  }

  public addPendingTool(tool: PendingTool): void {
    this.#pendingTools.push(tool);
    if (this.#pendingTools.length === 1) {
      this.#selectedTool = 0;
    }
    this.render();
  }

  public removePendingTool(requestId: string): void {
    const idx = this.#pendingTools.findIndex((t) => t.requestId === requestId);
    if (idx < 0) {
      return;
    }
    this.#pendingTools.splice(idx, 1);
    this.#selectedTool = Math.min(this.#selectedTool, Math.max(0, this.#pendingTools.length - 1));
    this.render();
  }

  public setCancelFn(fn: (() => void) | null): void {
    this.#cancelFn = fn;
  }

  /**
   * Append text to the most recent sealed block of the given type.
   * Used for retroactive annotations (e.g. adding turn cost to the tools block after
   * the next message_usage arrives). Has no effect if no matching block exists.
   */
  public appendToLastSealed(type: BlockType, text: string): void {
    const activeType = this.#conversationState.activeBlock?.type ?? null;
    logger.debug('appendToLastSealed', { type, activeType, totalSealed: this.#conversationState.sealedBlocks.length });
    // When tool batches run back-to-back (no thinking/text between them), transitionBlock
    // is a no-op so the tools block stays *active* when message_usage fires. Check active first.
    const result = this.#conversationState.appendToLastSealed(type, text);
    if (result === 'active') {
      logger.debug('appendToLastSealed_found', { target: 'active' });
      this.render();
    } else if (result === 'miss') {
      logger.warn('appendToLastSealed_miss', { type, activeType });
    } else {
      logger.debug('appendToLastSealed_found', { index: result, totalSealed: this.#conversationState.sealedBlocks.length });
      this.render();
    }
  }

  public updateUsage(msg: SdkMessageUsage): void {
    this.#statusState.update(msg);
    this.render();
  }

  /** Enter editor mode and wait for the user to submit input via Ctrl+Enter. */
  public waitForInput(): Promise<string> {
    this.#mode = 'editor';
    this.#editorState.reset();
    this.#toolExpanded = false;
    this.render();
    return new Promise((resolve) => {
      this.#editorResolve = resolve;
    });
  }

  /**
   * Wait for the user to approve or deny a tool via Y/N.
   * The tool must already be added via addPendingTool before calling this.
   * Multiple calls queue up; Y/N resolves them in FIFO order.
   */
  public requestApproval(): Promise<boolean> {
    return new Promise((resolve) => {
      this.#pendingApprovals.push(resolve);
      this.render();
    });
  }

  /** Debounced render for key events — batches rapid input (paste) into one repaint. */
  #scheduleRender(): void {
    if (!this.#renderPending) {
      this.#renderPending = true;
      setImmediate(() => {
        this.#renderPending = false;
        this.render();
      });
    }
  }

  public handleKey(key: KeyAction): void {
    if (key.type === 'ctrl+c') {
      this.exit();
      process.exit(0);
    }

    if (key.type === 'ctrl+/') {
      if (this.#mode === 'editor') {
        this.#commandMode = !this.#commandMode;
        this.render();
      }
      return;
    }

    if (key.type === 'escape') {
      if (this.#commandMode) {
        this.#commandMode = false;
        this.#previewMode = false;
        this.render();
        return;
      }
      this.#cancelFn?.();
      return;
    }

    // Y/N resolves the first queued approval
    if (this.#pendingApprovals.length > 0 && key.type === 'char') {
      const ch = key.value.toUpperCase();
      if (ch === 'Y' || ch === 'N') {
        const resolve = this.#pendingApprovals.shift();
        resolve?.(ch === 'Y');
        this.render();
        return;
      }
    }

    // Tool navigation: left/right to cycle, space to expand/collapse
    if (this.#pendingTools.length > 0) {
      if (key.type === 'char' && key.value === ' ') {
        this.#toolExpanded = !this.#toolExpanded;
        this.render();
        return;
      }
      if (key.type === 'left') {
        this.#selectedTool = Math.max(0, this.#selectedTool - 1);
        this.#toolExpanded = false;
        this.render();
        return;
      }
      if (key.type === 'right') {
        this.#selectedTool = Math.min(this.#pendingTools.length - 1, this.#selectedTool + 1);
        this.#toolExpanded = false;
        this.render();
        return;
      }
    }

    if (this.#mode !== 'editor') {
      return;
    }

    // Command mode: consume all keys, dispatch actions immediately
    if (this.#commandMode) {
      this.#handleCommandKey(key);
      return;
    }

    if (this.#editorState.handleKey(key)) {
      this.#scheduleRender();
      return;
    }

    if (key.type !== 'ctrl+enter') {
      return;
    }
    const text = this.#editorState.text.trim();
    if (!text && !this.#attachments.hasAttachments) {
      return;
    }
    if (!this.#editorResolve) {
      return;
    }
    const attachments = this.#attachments.takeAttachments();
    const parts: string[] = [text];
    if (attachments) {
      for (let n = 0; n < attachments.length; n++) {
        const att = attachments[n];
        if (!att) {
          continue;
        }
        if (att.kind === 'text') {
          const showSize = att.sizeBytes >= 1024 ? `${(att.sizeBytes / 1024).toFixed(1)}KB` : `${att.sizeBytes}B`;
          const fullSize = att.fullSizeBytes >= 1024 ? `${(att.fullSizeBytes / 1024).toFixed(1)}KB` : `${att.fullSizeBytes}B`;
          const truncPrefix = att.truncated ? `// showing ${showSize} of ${fullSize} (truncated)\n` : '';
          parts.push(`\n\n[attachment #${n + 1}]\n${truncPrefix}${att.text}\n[/attachment]`);
        } else {
          const lines: string[] = [`path: ${att.path}`];
          if (att.fileType === 'missing') {
            lines.push('// not found');
          } else {
            lines.push(`type: ${att.fileType}`);
            if (att.fileType === 'file' && att.sizeBytes !== undefined) {
              const sz = att.sizeBytes;
              const sizeStr = sz >= 1024 ? `${(sz / 1024).toFixed(1)}KB` : `${sz}B`;
              lines.push(`size: ${sizeStr}`);
            }
          }
          parts.push(`\n\n[attachment #${n + 1}]\n${lines.join('\n')}\n[/attachment]`);
        }
      }
    }
    const resolveInput = this.#editorResolve;
    this.#editorResolve = null;
    resolveInput(parts.join(''));
  }

  #flushToScroll(): void {
    const sealedBlocks = this.#conversationState.sealedBlocks;
    const flushedCount = this.#conversationState.flushedCount;
    if (flushedCount >= sealedBlocks.length) {
      return;
    }
    const cols = this.#screen.columns;
    const out = renderBlocksToString(sealedBlocks, flushedCount, cols);
    this.#conversationState.advanceFlushedCount(sealedBlocks.length);
    this.#screen.exitAltBuffer();
    this.#screen.write(out);
    this.#screen.enterAltBuffer();
  }

  public render(): void {
    const cols = this.#screen.columns;
    const totalRows = this.#screen.rows;

    const expandedRows = this.#buildExpandedRows(cols);
    const commandRow = this.#buildCommandRow(cols);
    // Fixed status bar: separator (1) + status line (1) + approval row (1) + command row (always 1) + optional expanded rows
    const statusBarHeight = 4 + expandedRows.length;
    const contentRows = Math.max(2, totalRows - statusBarHeight);

    // Build content rows: conversation blocks + editor (when in editor mode)
    const allContent = renderConversation(this.#conversationState, cols);
    if (this.#mode === 'editor') {
      allContent.push(buildDivider('prompt', cols));
      allContent.push('');
      allContent.push(...renderEditor(this.#editorState, cols));
    }

    // Fit to contentRows: take last N rows, pad from top if short
    const overflow = allContent.length - contentRows;
    const visibleRows = overflow > 0 ? allContent.slice(overflow) : [...new Array<string>(contentRows - allContent.length).fill(''), ...allContent];

    const separator = buildDivider(null, cols);
    const statusLine = this.#buildStatusLine(cols);
    const approvalRow = this.#buildApprovalRow(cols);
    const allRows = [...visibleRows, separator, statusLine, approvalRow, commandRow, ...expandedRows];

    let out = syncStart + hideCursor;
    out += cursorAt(1, 1);
    for (let i = 0; i < allRows.length - 1; i++) {
      out += `\r${clearLine}${allRows[i] ?? ''}\n`;
    }
    out += clearDown;
    const lastRow = allRows[allRows.length - 1];
    if (lastRow !== undefined) {
      out += `\r${clearLine}${lastRow}`;
    }

    // Virtual cursor is rendered inline in the editor lines above; keep terminal cursor hidden.

    out += syncEnd;
    this.#screen.write(out);
  }

  #handleCommandKey(key: KeyAction): void {
    if (key.type === 'char') {
      switch (key.value) {
        case 't': {
          readClipboardText()
            .then((text) => {
              if (text) {
                this.#attachments.addText(text);
              }
              this.render();
            })
            .catch(() => {
              this.render();
            });
          return;
        }
        case 'f': {
          readClipboardPath()
            .then(async (pathText) => {
              const filePath = pathText?.trim();
              if (filePath) {
                const expanded = filePath.replace(/^~(?=\/|$)/, process.env.HOME ?? '');
                const resolved = resolve(expanded);
                try {
                  const info = await stat(resolved);
                  // File exists — attach it directly, no further heuristic needed.
                  if (info.isDirectory()) {
                    this.#attachments.addFile(resolved, 'dir');
                  } else {
                    this.#attachments.addFile(resolved, 'file', info.size);
                  }
                } catch {
                  // File not found — only create a missing chip if the text
                  // looks like a deliberate path (explicit prefix).
                  if (isLikelyPath(filePath)) {
                    this.#attachments.addFile(resolved, 'missing');
                  }
                }
              }
              this.render();
            })
            .catch(() => {
              this.render();
            });
          return;
        }
        case 'd':
          this.#attachments.removeSelected();
          this.render();
          return;
        case 'p':
          if (this.#attachments.selectedIndex >= 0) {
            this.#previewMode = !this.#previewMode;
          }
          this.render();
          return;
      }
    }
    if (key.type === 'left') {
      this.#attachments.selectLeft();
      this.render();
      return;
    }
    if (key.type === 'right') {
      this.#attachments.selectRight();
      this.render();
      return;
    }
    // All other keys silently consumed
  }

  #buildCommandRow(_cols: number): string {
    const hasAttachments = this.#attachments.hasAttachments;
    if (!this.#commandMode && !hasAttachments) {
      return '';
    }
    const b = new StatusLineBuilder();
    b.text(' ');
    const atts = this.#attachments.attachments;
    for (let i = 0; i < atts.length; i++) {
      const att = atts[i];
      if (!att) {
        continue;
      }
      let chip: string;
      if (att.kind === 'text') {
        if (att.truncated) {
          const fullStr = att.fullSizeBytes >= 1024 ? `${(att.fullSizeBytes / 1024).toFixed(1)}KB` : `${att.fullSizeBytes}B`;
          chip = `[txt ${fullStr}!]`;
        } else {
          const sizeStr = att.sizeBytes >= 1024 ? `${(att.sizeBytes / 1024).toFixed(1)}KB` : `${att.sizeBytes}B`;
          chip = `[txt ${sizeStr}]`;
        }
      } else {
        const name = basename(att.path);
        if (att.fileType === 'missing') {
          chip = `[${name} ?]`;
        } else if (att.fileType === 'dir') {
          chip = `[${name}/]`;
        } else {
          const sz = att.sizeBytes ?? 0;
          const sizeStr = sz >= 1024 ? `${(sz / 1024).toFixed(1)}KB` : `${sz}B`;
          chip = `[${name} ${sizeStr}]`;
        }
      }
      if (this.#commandMode && i === this.#attachments.selectedIndex) {
        b.ansi(INVERSE_ON);
        b.text(chip);
        b.ansi(INVERSE_OFF);
      } else {
        b.ansi(DIM);
        b.text(chip);
        b.ansi(RESET);
      }
      b.text(' ');
    }
    if (this.#commandMode) {
      b.ansi(DIM);
      b.text('cmd');
      b.ansi(RESET);
      if (hasAttachments) {
        b.text('  \u2190 \u2192 select  d del  p prev  \u00b7  t paste  \u00b7  f file  \u00b7  ESC cancel');
      } else {
        b.text('  t paste  ·  f file  ·  ESC cancel');
      }
    }
    return b.output;
  }

  #buildStatusLine(cols: number): string {
    return renderStatus(this.#statusState, cols);
  }

  #buildApprovalRow(_cols: number): string {
    if (this.#pendingTools.length === 0) {
      return '';
    }
    const tool = this.#pendingTools[this.#selectedTool];
    if (!tool) {
      return '';
    }

    const idx = this.#selectedTool + 1;
    const total = this.#pendingTools.length;
    const nav = total > 1 ? ` \u2190 ${idx}/${total} \u2192` : '';
    const needsApproval = this.#pendingApprovals.length > 0;
    const prefix = needsApproval ? 'Allow ' : '';
    const approval = needsApproval ? '  [Y/N]' : '';
    const expand = this.#toolExpanded ? ' [space: collapse]' : ' [space: expand]';
    return ` ${prefix}Tool: ${tool.name}${nav}${approval}${expand}`;
  }

  #buildExpandedRows(cols: number): string[] {
    if (this.#toolExpanded && this.#pendingTools.length > 0) {
      const tool = this.#pendingTools[this.#selectedTool];
      if (tool) {
        const rows: string[] = [];
        for (const line of JSON.stringify(tool.input, null, 2).split('\n')) {
          rows.push(...wrapLine(CONTENT_INDENT + line, cols));
        }
        // Cap at half the screen height to leave room for content
        return rows.slice(0, Math.floor(this.#screen.rows / 2));
      }
    }
    if (this.#previewMode && this.#commandMode) {
      return this.#buildPreviewRows(cols);
    }
    return [];
  }

  #buildPreviewRows(cols: number): string[] {
    const idx = this.#attachments.selectedIndex;
    if (idx < 0) {
      return [];
    }
    const att = this.#attachments.attachments[idx];
    if (!att) {
      return [];
    }

    const rows: string[] = [];
    if (att.kind === 'text') {
      if (att.truncated) {
        const showSize = att.sizeBytes >= 1024 ? `${(att.sizeBytes / 1024).toFixed(1)}KB` : `${att.sizeBytes}B`;
        const fullSize = att.fullSizeBytes >= 1024 ? `${(att.fullSizeBytes / 1024).toFixed(1)}KB` : `${att.fullSizeBytes}B`;
        rows.push(DIM + `   showing ${showSize} of ${fullSize} (truncated)` + RESET);
      }
      const lines = att.text.split('\n');
      const maxPreviewLines = Math.max(1, Math.floor(this.#screen.rows / 3));
      for (const line of lines.slice(0, maxPreviewLines)) {
        rows.push(...wrapLine(CONTENT_INDENT + line, cols));
      }
      if (lines.length > maxPreviewLines) {
        rows.push(DIM + `   \u2026 ${lines.length - maxPreviewLines} more lines` + RESET);
      }
    } else {
      rows.push(`   path: ${att.path}`);
      if (att.fileType === 'file') {
        const sz = att.sizeBytes ?? 0;
        const sizeStr = sz >= 1024 ? `${(sz / 1024).toFixed(1)}KB` : `${sz}B`;
        rows.push(`   type: file  size: ${sizeStr}`);
      } else if (att.fileType === 'dir') {
        rows.push('   type: dir');
      } else {
        rows.push('   // not found');
      }
    }
    return rows.slice(0, Math.floor(this.#screen.rows / 2));
  }
}
