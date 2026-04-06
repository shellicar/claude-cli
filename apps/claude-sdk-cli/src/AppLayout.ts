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
import { highlight } from 'cli-highlight';
import { AttachmentStore } from './AttachmentStore.js';
import { readClipboardPath, readClipboardText } from './clipboard.js';
import { logger } from './logger.js';

export type PendingTool = {
  requestId: string;
  name: string;
  input: Record<string, unknown>;
};

type Mode = 'editor' | 'streaming';

type BlockType = 'prompt' | 'thinking' | 'response' | 'tools' | 'compaction' | 'meta';

type Block = {
  type: BlockType;
  content: string;
};

const FILL = '\u2500';

const BLOCK_PLAIN: Record<string, string> = {
  prompt: 'prompt',
  thinking: 'thinking',
  response: 'response',
  tools: 'tools',
  compaction: 'compaction',
  meta: 'query',
};

const BLOCK_EMOJI: Record<string, string> = {
  prompt: '💬 ',
  thinking: '💭 ',
  response: '📝 ',
  tools: '🔧 ',
  compaction: '🗜 ',
  meta: 'ℹ️  ',
};

const EDITOR_PROMPT = '💬 ';
const CONTENT_INDENT = '   ';

const CODE_FENCE_RE = /```(\w*)\n([\s\S]*?)```/g;

function renderBlockContent(content: string, cols: number): string[] {
  const result: string[] = [];
  let lastIndex = 0;

  const addText = (text: string) => {
    const lines = text.split('\n');
    const trimmed = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
    for (const line of trimmed) {
      result.push(...wrapLine(CONTENT_INDENT + line, cols));
    }
  };

  for (const match of content.matchAll(CODE_FENCE_RE)) {
    if (match.index > lastIndex) {
      addText(content.slice(lastIndex, match.index));
    }
    const lang = match[1] || 'plaintext';
    const code = (match[2] ?? '').trimEnd();
    result.push(`${CONTENT_INDENT}\`\`\`${lang}`);
    try {
      const highlighted = highlight(code, { language: lang, ignoreIllegals: true });
      for (const line of highlighted.split('\n')) {
        result.push(CONTENT_INDENT + line);
      }
    } catch {
      for (const line of code.split('\n')) {
        result.push(CONTENT_INDENT + line);
      }
    }
    result.push(`${CONTENT_INDENT}\`\`\``);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    addText(content.slice(lastIndex));
  } else if (lastIndex === 0) {
    addText(content);
  }

  return result;
}

function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

function buildDivider(displayLabel: string | null, cols: number): string {
  if (!displayLabel) {
    return DIM + FILL.repeat(cols) + RESET;
  }
  const prefix = `${FILL}${FILL} ${displayLabel} `;
  const remaining = Math.max(0, cols - prefix.length);
  return DIM + prefix + FILL.repeat(remaining) + RESET;
}

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
  #sealedBlocks: Block[] = [];
  #flushedCount = 0;
  #activeBlock: Block | null = null;
  #editorLines: string[] = [''];
  #cursorLine = 0;
  #cursorCol = 0;
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

  #totalInputTokens = 0;
  #totalCacheCreationTokens = 0;
  #totalCacheReadTokens = 0;
  #totalOutputTokens = 0;
  #totalCostUsd = 0;
  #lastContextUsed = 0;
  #contextWindow = 0;

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
    this.#sealedBlocks.push({ type: 'meta', content: text });
    this.render();
  }

  /** Push pre-built sealed blocks (e.g. from history replay) and render once. */
  public addHistoryBlocks(blocks: { type: BlockType; content: string }[]): void {
    for (const block of blocks) {
      this.#sealedBlocks.push(block);
    }
    this.render();
  }

  public exit(): void {
    this.#cleanupResize();
    this.#screen.exitAltBuffer();
  }

  /** Transition to streaming mode. Seals the prompt as a block; active block is created on first content. */
  public startStreaming(prompt: string): void {
    this.#sealedBlocks.push({ type: 'prompt', content: prompt });
    this.#activeBlock = null;
    this.#mode = 'streaming';
    this.#flushToScroll();
    this.render();
  }

  /** Transition to a new block type. Seals the current block (if it has content) and opens a fresh one.
   * Consecutive same-type blocks are merged visually by the renderer (no header or gap between them),
   * so there is nothing special to do here — every call produces its own block. */
  public transitionBlock(type: BlockType): void {
    if (this.#activeBlock?.type === type) {
      logger.debug('transitionBlock_noop', { type, totalSealed: this.#sealedBlocks.length });
      return;
    }
    const from = this.#activeBlock?.type ?? null;
    const sealed = !!this.#activeBlock?.content.trim();
    if (this.#activeBlock?.content.trim()) {
      this.#sealedBlocks.push(this.#activeBlock);
    }
    logger.debug('transitionBlock', { from, to: type, sealed, totalSealed: this.#sealedBlocks.length });
    this.#activeBlock = { type, content: '' };
    this.render();
  }

  /** Append a chunk of text to the active block. */
  public appendStreaming(text: string): void {
    if (this.#activeBlock) {
      this.#activeBlock.content += sanitiseLoneSurrogates(text);
      this.render();
    }
  }

  /** Seal the completed response block and return to editor mode. */
  public completeStreaming(): void {
    if (this.#activeBlock?.content.trim()) {
      this.#sealedBlocks.push(this.#activeBlock);
    }
    this.#activeBlock = null;
    this.#pendingTools = [];
    this.#mode = 'editor';
    this.#commandMode = false;
    this.#previewMode = false;
    this.#attachments.clear();
    this.#editorLines = [''];
    this.#cursorLine = 0;
    this.#cursorCol = 0;
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
    const activeType = this.#activeBlock?.type ?? null;
    logger.debug('appendToLastSealed', { type, activeType, totalSealed: this.#sealedBlocks.length });
    // When tool batches run back-to-back (no thinking/text between them), transitionBlock
    // is a no-op so the tools block stays *active* when message_usage fires. Check active first.
    if (this.#activeBlock?.type === type) {
      logger.debug('appendToLastSealed_found', { target: 'active' });
      this.#activeBlock.content += text;
      this.render();
      return;
    }
    for (let i = this.#sealedBlocks.length - 1; i >= 0; i--) {
      if (this.#sealedBlocks[i]?.type === type) {
        logger.debug('appendToLastSealed_found', { index: i, totalSealed: this.#sealedBlocks.length });
        // biome-ignore lint/style/noNonNullAssertion: checked above
        this.#sealedBlocks[i]!.content += text;
        this.render();
        return;
      }
    }
    logger.warn('appendToLastSealed_miss', { type, activeType });
  }

  public updateUsage(msg: SdkMessageUsage): void {
    this.#totalInputTokens += msg.inputTokens;
    this.#totalCacheCreationTokens += msg.cacheCreationTokens;
    this.#totalCacheReadTokens += msg.cacheReadTokens;
    this.#totalOutputTokens += msg.outputTokens;
    this.#totalCostUsd += msg.costUsd;
    this.#lastContextUsed = msg.inputTokens + msg.cacheCreationTokens + msg.cacheReadTokens;
    this.#contextWindow = msg.contextWindow;
    this.render();
  }

  /** Enter editor mode and wait for the user to submit input via Ctrl+Enter. */
  public waitForInput(): Promise<string> {
    this.#mode = 'editor';
    this.#editorLines = [''];
    this.#cursorLine = 0;
    this.#cursorCol = 0;
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

  /** Returns the column index of the start of the word to the left of col. */
  #wordStartLeft(line: string, col: number): number {
    let c = col;
    while (c > 0 && line[c - 1] === ' ') {
      c--;
    }
    while (c > 0 && line[c - 1] !== ' ') {
      c--;
    }
    return c;
  }

  /** Returns the column index of the end of the word to the right of col. */
  #wordEndRight(line: string, col: number): number {
    let c = col;
    while (c < line.length && line[c] === ' ') {
      c++;
    }
    while (c < line.length && line[c] !== ' ') {
      c++;
    }
    return c;
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

    switch (key.type) {
      case 'enter': {
        // Split current line at cursor
        const cur = this.#editorLines[this.#cursorLine] ?? '';
        const before = cur.slice(0, this.#cursorCol);
        const after = cur.slice(this.#cursorCol);
        this.#editorLines[this.#cursorLine] = before;
        this.#editorLines.splice(this.#cursorLine + 1, 0, after);
        this.#cursorLine++;
        this.#cursorCol = 0;
        this.#scheduleRender();
        break;
      }
      case 'ctrl+enter': {
        const text = this.#editorLines.join('\n').trim();
        if (!text && !this.#attachments.hasAttachments) {
          break;
        }
        if (!this.#editorResolve) {
          break;
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
        break;
      }
      case 'backspace': {
        if (this.#cursorCol > 0) {
          const line = this.#editorLines[this.#cursorLine] ?? '';
          this.#editorLines[this.#cursorLine] = line.slice(0, this.#cursorCol - 1) + line.slice(this.#cursorCol);
          this.#cursorCol--;
        } else if (this.#cursorLine > 0) {
          // Join with previous line
          const prev = this.#editorLines[this.#cursorLine - 1] ?? '';
          const curr = this.#editorLines[this.#cursorLine] ?? '';
          this.#editorLines.splice(this.#cursorLine, 1);
          this.#cursorLine--;
          this.#cursorCol = prev.length;
          this.#editorLines[this.#cursorLine] = prev + curr;
        }
        this.#scheduleRender();
        break;
      }
      case 'delete': {
        const line = this.#editorLines[this.#cursorLine] ?? '';
        if (this.#cursorCol < line.length) {
          this.#editorLines[this.#cursorLine] = line.slice(0, this.#cursorCol) + line.slice(this.#cursorCol + 1);
        } else if (this.#cursorLine < this.#editorLines.length - 1) {
          // Join with next line
          const next = this.#editorLines[this.#cursorLine + 1] ?? '';
          this.#editorLines.splice(this.#cursorLine + 1, 1);
          this.#editorLines[this.#cursorLine] = line + next;
        }
        this.#scheduleRender();
        break;
      }
      case 'ctrl+backspace': {
        if (this.#cursorCol === 0) {
          // At start of line: cross the newline boundary, same as plain backspace
          if (this.#cursorLine > 0) {
            const prev = this.#editorLines[this.#cursorLine - 1] ?? '';
            const curr = this.#editorLines[this.#cursorLine] ?? '';
            this.#editorLines.splice(this.#cursorLine, 1);
            this.#cursorLine--;
            this.#cursorCol = prev.length;
            this.#editorLines[this.#cursorLine] = prev + curr;
          }
        } else {
          const line = this.#editorLines[this.#cursorLine] ?? '';
          const newCol = this.#wordStartLeft(line, this.#cursorCol);
          this.#editorLines[this.#cursorLine] = line.slice(0, newCol) + line.slice(this.#cursorCol);
          this.#cursorCol = newCol;
        }
        this.#scheduleRender();
        break;
      }
      case 'ctrl+delete': {
        const line = this.#editorLines[this.#cursorLine] ?? '';
        if (this.#cursorCol === line.length) {
          // At EOL: cross the newline boundary, same as plain delete
          if (this.#cursorLine < this.#editorLines.length - 1) {
            const next = this.#editorLines[this.#cursorLine + 1] ?? '';
            this.#editorLines.splice(this.#cursorLine + 1, 1);
            this.#editorLines[this.#cursorLine] = line + next;
          }
        } else {
          const newCol = this.#wordEndRight(line, this.#cursorCol);
          this.#editorLines[this.#cursorLine] = line.slice(0, this.#cursorCol) + line.slice(newCol);
        }
        this.#scheduleRender();
        break;
      }
      case 'ctrl+k': {
        const line = this.#editorLines[this.#cursorLine] ?? '';
        if (this.#cursorCol < line.length) {
          // Kill to end of line
          this.#editorLines[this.#cursorLine] = line.slice(0, this.#cursorCol);
        } else if (this.#cursorLine < this.#editorLines.length - 1) {
          // At EOL: join with next line
          const next = this.#editorLines[this.#cursorLine + 1] ?? '';
          this.#editorLines.splice(this.#cursorLine + 1, 1);
          this.#editorLines[this.#cursorLine] = line + next;
        }
        this.#scheduleRender();
        break;
      }
      case 'ctrl+u': {
        const line = this.#editorLines[this.#cursorLine] ?? '';
        this.#editorLines[this.#cursorLine] = line.slice(this.#cursorCol);
        this.#cursorCol = 0;
        this.#scheduleRender();
        break;
      }
      case 'left': {
        if (this.#cursorCol > 0) {
          this.#cursorCol--;
        } else if (this.#cursorLine > 0) {
          this.#cursorLine--;
          this.#cursorCol = (this.#editorLines[this.#cursorLine] ?? '').length;
        }
        this.#scheduleRender();
        break;
      }
      case 'right': {
        const line = this.#editorLines[this.#cursorLine] ?? '';
        if (this.#cursorCol < line.length) {
          this.#cursorCol++;
        } else if (this.#cursorLine < this.#editorLines.length - 1) {
          this.#cursorLine++;
          this.#cursorCol = 0;
        }
        this.#scheduleRender();
        break;
      }
      case 'up': {
        if (this.#cursorLine > 0) {
          this.#cursorLine--;
          const newLine = this.#editorLines[this.#cursorLine] ?? '';
          this.#cursorCol = Math.min(this.#cursorCol, newLine.length);
        }
        this.#scheduleRender();
        break;
      }
      case 'down': {
        if (this.#cursorLine < this.#editorLines.length - 1) {
          this.#cursorLine++;
          const newLine = this.#editorLines[this.#cursorLine] ?? '';
          this.#cursorCol = Math.min(this.#cursorCol, newLine.length);
        }
        this.#scheduleRender();
        break;
      }
      case 'home': {
        this.#cursorCol = 0;
        this.#scheduleRender();
        break;
      }
      case 'end': {
        this.#cursorCol = (this.#editorLines[this.#cursorLine] ?? '').length;
        this.#scheduleRender();
        break;
      }
      case 'ctrl+home': {
        this.#cursorLine = 0;
        this.#cursorCol = 0;
        this.#scheduleRender();
        break;
      }
      case 'ctrl+end': {
        this.#cursorLine = this.#editorLines.length - 1;
        this.#cursorCol = (this.#editorLines[this.#cursorLine] ?? '').length;
        this.#scheduleRender();
        break;
      }
      case 'ctrl+left': {
        const line = this.#editorLines[this.#cursorLine] ?? '';
        this.#cursorCol = this.#wordStartLeft(line, this.#cursorCol);
        this.#scheduleRender();
        break;
      }
      case 'ctrl+right': {
        const line = this.#editorLines[this.#cursorLine] ?? '';
        this.#cursorCol = this.#wordEndRight(line, this.#cursorCol);
        this.#scheduleRender();
        break;
      }
      case 'char': {
        const line = this.#editorLines[this.#cursorLine] ?? '';
        this.#editorLines[this.#cursorLine] = line.slice(0, this.#cursorCol) + key.value + line.slice(this.#cursorCol);
        this.#cursorCol += key.value.length;
        this.#scheduleRender();
        break;
      }
    }
  }

  #flushToScroll(): void {
    if (this.#flushedCount >= this.#sealedBlocks.length) {
      return;
    }
    const cols = this.#screen.columns;
    let out = '';
    for (let i = this.#flushedCount; i < this.#sealedBlocks.length; i++) {
      const block = this.#sealedBlocks[i];
      if (!block) {
        continue;
      }
      // Consecutive blocks of the same type are shown without a header or gap between them.
      const isContinuation = this.#sealedBlocks[i - 1]?.type === block.type;
      const hasNextContinuation = this.#sealedBlocks[i + 1]?.type === block.type;
      if (!isContinuation) {
        const emoji = BLOCK_EMOJI[block.type] ?? '';
        const plain = BLOCK_PLAIN[block.type] ?? block.type;
        out += `${buildDivider(`${emoji}${plain}`, cols)}\n\n`;
      }
      for (const line of renderBlockContent(block.content, cols)) {
        out += `${line}\n`;
      }
      if (!hasNextContinuation) {
        out += '\n';
      }
    }
    this.#flushedCount = this.#sealedBlocks.length;
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

    // Build all content rows from sealed blocks, active block, and editor
    const allContent: string[] = [];

    for (let i = 0; i < this.#sealedBlocks.length; i++) {
      const block = this.#sealedBlocks[i];
      if (!block) {
        continue;
      }
      // Consecutive blocks of the same type flow as one: skip header and gap for continuations,
      // and suppress the trailing blank when the next block will continue the sequence.
      const isContinuation = this.#sealedBlocks[i - 1]?.type === block.type;
      const nextBlock = this.#sealedBlocks[i + 1] ?? (i === this.#sealedBlocks.length - 1 ? this.#activeBlock : undefined);
      const hasNextContinuation = nextBlock?.type === block.type;
      if (!isContinuation) {
        const emoji = BLOCK_EMOJI[block.type] ?? '';
        const plain = BLOCK_PLAIN[block.type] ?? block.type;
        allContent.push(buildDivider(`${emoji}${plain}`, cols));
        allContent.push('');
      }
      allContent.push(...renderBlockContent(block.content, cols));
      if (!hasNextContinuation) {
        allContent.push('');
      }
    }

    if (this.#activeBlock) {
      const lastSealed = this.#sealedBlocks[this.#sealedBlocks.length - 1];
      const isContinuation = lastSealed?.type === this.#activeBlock.type;
      if (!isContinuation) {
        const activeEmoji = BLOCK_EMOJI[this.#activeBlock.type] ?? '';
        const activePlain = BLOCK_PLAIN[this.#activeBlock.type] ?? this.#activeBlock.type;
        allContent.push(buildDivider(`${activeEmoji}${activePlain}`, cols));
        allContent.push('');
      }
      const activeEmoji = BLOCK_EMOJI[this.#activeBlock.type] ?? '';
      const activeLines = this.#activeBlock.content.split('\n');
      for (let i = 0; i < activeLines.length; i++) {
        const pfx = i === 0 ? activeEmoji : CONTENT_INDENT;
        allContent.push(...wrapLine(pfx + (activeLines[i] ?? ''), cols));
      }
    }

    if (this.#mode === 'editor') {
      allContent.push(buildDivider(BLOCK_PLAIN.prompt ?? 'prompt', cols));
      allContent.push('');
      for (let i = 0; i < this.#editorLines.length; i++) {
        const pfx = i === 0 ? EDITOR_PROMPT : CONTENT_INDENT;
        const line = this.#editorLines[i] ?? '';
        if (i === this.#cursorLine) {
          // Render the character *under* the cursor in reverse-video (no text displacement).
          // At EOL there is no character, so use a space as the cursor block.
          const charUnder = line[this.#cursorCol] ?? ' ';
          const withCursor = `${line.slice(0, this.#cursorCol)}${INVERSE_ON}${charUnder}${INVERSE_OFF}${line.slice(this.#cursorCol + 1)}`;
          allContent.push(...wrapLine(pfx + withCursor, cols));
        } else {
          allContent.push(...wrapLine(pfx + line, cols));
        }
      }
    }

    // Fit to contentRows: take last N rows, pad from top if short
    const overflow = allContent.length - contentRows;
    const visibleRows = overflow > 0 ? allContent.slice(overflow) : [...new Array<string>(contentRows - allContent.length).fill(''), ...allContent];

    const separator = DIM + FILL.repeat(cols) + RESET;
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

  #buildStatusLine(_cols: number): string {
    if (this.#totalInputTokens === 0 && this.#totalOutputTokens === 0 && this.#totalCacheCreationTokens === 0) {
      return '';
    }
    const b = new StatusLineBuilder();
    b.text(` in: ${formatTokens(this.#totalInputTokens)}`);
    if (this.#totalCacheCreationTokens > 0) {
      b.text(`  ↑${formatTokens(this.#totalCacheCreationTokens)}`);
    }
    if (this.#totalCacheReadTokens > 0) {
      b.text(`  ↓${formatTokens(this.#totalCacheReadTokens)}`);
    }
    b.text(`  out: ${formatTokens(this.#totalOutputTokens)}`);
    b.text(`  $${this.#totalCostUsd.toFixed(4)}`);
    if (this.#contextWindow > 0) {
      const pct = ((this.#lastContextUsed / this.#contextWindow) * 100).toFixed(1);
      b.text(`  ctx: ${formatTokens(this.#lastContextUsed)}/${formatTokens(this.#contextWindow)} (${pct}%)`);
    }
    return b.output;
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
