import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { clearDown, clearLine, cursorAt, hideCursor, syncEnd, syncStart } from '@shellicar/claude-core/ansi';
import type { KeyAction } from '@shellicar/claude-core/input';
import { sanitiseLoneSurrogates } from '@shellicar/claude-core/sanitise';
import type { Screen } from '@shellicar/claude-core/screen';
import { StdoutScreen } from '@shellicar/claude-core/screen';
import { readClipboardPath, readClipboardText } from './clipboard.js';
import { logger } from './logger.js';
import { buildSubmitText } from './model/buildSubmitText.js';
import { CommandModeState } from './model/CommandModeState.js';
import type { Block, BlockType } from './model/ConversationState.js';
import { ConversationState } from './model/ConversationState.js';
import { EditorState } from './model/EditorState.js';
import type { StatusState } from './model/StatusState.js';
import type { PendingTool } from './model/ToolApprovalState.js';
import { ToolApprovalState } from './model/ToolApprovalState.js';
import { renderCommandMode } from './view/renderCommandMode.js';
import { buildDivider, renderBlocksToString, renderConversation } from './view/renderConversation.js';
import { renderEditor } from './view/renderEditor.js';
import { renderModel, renderStatus } from './view/renderStatus.js';
import { renderToolApproval } from './view/renderToolApproval.js';

export type { PendingTool } from './model/ToolApprovalState.js';

type Mode = 'editor' | 'streaming';

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
  #resizing = false;
  #resizeTimer: ReturnType<typeof setTimeout> | undefined;

  #toolApprovalState = new ToolApprovalState();

  #commandModeState = new CommandModeState();

  #editorResolve: ((value: string) => void) | null = null;
  #cancelFn: (() => void) | null = null;

  readonly #statusState: StatusState;

  public constructor(statusState: StatusState) {
    this.#statusState = statusState;
    this.#screen = new StdoutScreen();
    this.#cleanupResize = this.#screen.onResize(() => {
      this.#resizing = true;
      clearTimeout(this.#resizeTimer);
      this.#resizeTimer = setTimeout(() => {
        this.#resizing = false;
        this.render();
      }, 300);
    });
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
    clearTimeout(this.#resizeTimer);
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
    this.#toolApprovalState.clearTools();
    this.#mode = 'editor';
    this.#commandModeState.reset();
    this.#editorState.reset();
    this.#flushToScroll();
    this.render();
  }

  public addPendingTool(tool: PendingTool): void {
    this.#toolApprovalState.addTool(tool);
    this.render();
  }

  public removePendingTool(requestId: string): void {
    if (!this.#toolApprovalState.removeTool(requestId)) {
      return;
    }
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

  /** Enter editor mode and wait for the user to submit input via Ctrl+Enter. */
  public waitForInput(): Promise<string> {
    this.#mode = 'editor';
    this.#editorState.reset();
    this.#toolApprovalState.resetExpanded();
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
    const promise = this.#toolApprovalState.requestApproval();
    this.render();
    return promise;
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
        this.#commandModeState.toggleCommandMode();
        this.render();
      }
      return;
    }

    if (key.type === 'escape') {
      if (this.#commandModeState.commandMode) {
        this.#commandModeState.exitCommandMode();
        this.render();
        return;
      }
      this.#cancelFn?.();
      return;
    }

    // Y/N resolves the first queued approval
    if (this.#toolApprovalState.hasPendingApprovals && key.type === 'char') {
      const ch = key.value.toUpperCase();
      if (ch === 'Y' || ch === 'N') {
        this.#toolApprovalState.resolveNextApproval(ch === 'Y');
        this.render();
        return;
      }
    }

    // Tool navigation: left/right to cycle, space to expand/collapse
    if (this.#toolApprovalState.hasPendingTools) {
      if (key.type === 'char' && key.value === ' ') {
        this.#toolApprovalState.toggleExpanded();
        this.render();
        return;
      }
      if (key.type === 'left') {
        this.#toolApprovalState.selectPrev();
        this.render();
        return;
      }
      if (key.type === 'right') {
        this.#toolApprovalState.selectNext();
        this.render();
        return;
      }
    }

    if (this.#mode !== 'editor') {
      return;
    }

    // Command mode: consume all keys, dispatch actions immediately
    if (this.#commandModeState.commandMode) {
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
    if (!text && !this.#commandModeState.hasAttachments) {
      return;
    }
    if (!this.#editorResolve) {
      return;
    }
    const attachments = this.#commandModeState.takeAttachments();
    const resolveInput = this.#editorResolve;
    this.#editorResolve = null;
    resolveInput(buildSubmitText(text, attachments));
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
    if (this.#resizing) {
      return;
    }
    const cols = this.#screen.columns;
    const totalRows = this.#screen.rows;

    const { approvalRow, expandedRows: toolRows } = renderToolApproval(this.#toolApprovalState, cols, Math.floor(totalRows / 2));
    const { commandRow, previewRows } = renderCommandMode(this.#commandModeState, cols, Math.max(1, Math.floor(totalRows / 3)), Math.floor(totalRows / 2));
    const expandedRows = [...toolRows, ...previewRows];
    // Fixed status bar: separator (1) + model line (1) + status line (1) + approval row (1) + command row (always 1) + optional expanded rows
    const statusBarHeight = 5 + expandedRows.length;
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
    const modelLine = renderModel(this.#statusState, cols);
    const statusLine = renderStatus(this.#statusState, cols);
    const allRows = [...visibleRows, separator, modelLine, statusLine, approvalRow, commandRow, ...expandedRows];

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
                this.#commandModeState.addText(text);
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
                    this.#commandModeState.addFile(resolved, 'dir');
                  } else {
                    this.#commandModeState.addFile(resolved, 'file', info.size);
                  }
                } catch {
                  // File not found — only create a missing chip if the text
                  // looks like a deliberate path (explicit prefix).
                  if (isLikelyPath(filePath)) {
                    this.#commandModeState.addFile(resolved, 'missing');
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
          this.#commandModeState.removeSelected();
          this.render();
          return;
        case 'p':
          this.#commandModeState.togglePreview();
          this.render();
          return;
      }
    }
    if (key.type === 'left') {
      this.#commandModeState.selectLeft();
      this.render();
      return;
    }
    if (key.type === 'right') {
      this.#commandModeState.selectRight();
      this.render();
      return;
    }
    // All other keys silently consumed
  }
}
