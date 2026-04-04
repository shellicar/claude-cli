import { DIM, RESET, clearDown, clearLine, cursorAt, hideCursor, showCursor, syncEnd, syncStart } from '@shellicar/claude-core/ansi';
import type { KeyAction } from '@shellicar/claude-core/input';
import { wrapLine } from '@shellicar/claude-core/reflow';
import { sanitiseLoneSurrogates } from '@shellicar/claude-core/sanitise';
import type { Screen } from '@shellicar/claude-core/screen';
import { StdoutScreen } from '@shellicar/claude-core/screen';

export type PendingTool = {
  requestId: string;
  name: string;
  input: Record<string, unknown>;
};

type Mode = 'editor' | 'streaming';

type BlockType = 'prompt' | 'thinking' | 'response' | 'tools' | 'compaction';

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
};

const BLOCK_EMOJI: Record<string, string> = {
  prompt: '💬 ',
  thinking: '💭 ',
  response: '📝 ',
  tools: '🔧 ',
  compaction: '🗜 ',
};

const EDITOR_PROMPT = '💬 ';
const CONTENT_INDENT = '   ';

function buildDivider(displayLabel: string | null, cols: number): string {
  if (!displayLabel) {
    return DIM + FILL.repeat(cols) + RESET;
  }
  const prefix = `${FILL}${FILL} ${displayLabel} `;
  const remaining = Math.max(0, cols - prefix.length);
  return DIM + prefix + FILL.repeat(remaining) + RESET;
}

export class AppLayout implements Disposable {
  readonly #screen: Screen;
  readonly #cleanupResize: () => void;

  #mode: Mode = 'editor';
  #sealedBlocks: Block[] = [];
  #flushedCount = 0;
  #activeBlock: Block | null = null;
  #editorLines: string[] = [''];

  #pendingTools: PendingTool[] = [];
  #selectedTool = 0;
  #toolExpanded = false;

  #editorResolve: ((value: string) => void) | null = null;
  #pendingApprovals: Array<(approved: boolean) => void> = [];
  #cancelFn: (() => void) | null = null;

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

  /** Transition to a new block type. If the type differs from the active block, seals the current block and opens a new one.
   * If the active block has no meaningful content (whitespace-only), it is discarded and the last sealed block of the
   * same target type is resumed instead. */
  public transitionBlock(type: BlockType): void {
    if (this.#activeBlock?.type === type) return;
    const activeHasContent = Boolean(this.#activeBlock?.content.trim());
    if (activeHasContent) {
      this.#sealedBlocks.push(this.#activeBlock!);
    }
    if (!activeHasContent) {
      const lastSealed = this.#sealedBlocks[this.#sealedBlocks.length - 1];
      if (lastSealed?.type === type) {
        this.#activeBlock = this.#sealedBlocks.pop() ?? null;
        this.render();
        return;
      }
    }
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
    this.#editorLines = [''];
    this.#flushToScroll();
    this.render();
  }

  public addPendingTool(tool: PendingTool): void {
    this.#pendingTools.push(tool);
    if (this.#pendingTools.length === 1) this.#selectedTool = 0;
    this.render();
  }

  public removePendingTool(requestId: string): void {
    const idx = this.#pendingTools.findIndex((t) => t.requestId === requestId);
    if (idx < 0) return;
    this.#pendingTools.splice(idx, 1);
    this.#selectedTool = Math.min(this.#selectedTool, Math.max(0, this.#pendingTools.length - 1));
    this.render();
  }

  public setCancelFn(fn: (() => void) | null): void {
    this.#cancelFn = fn;
  }

  /** Enter editor mode and wait for the user to submit input via Ctrl+Enter. */
  public waitForInput(): Promise<string> {
    this.#mode = 'editor';
    this.#editorLines = [''];
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

  public handleKey(key: KeyAction): void {
    if (key.type === 'ctrl+c') {
      this.exit();
      process.exit(0);
    }

    if (key.type === 'escape') {
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

    if (this.#mode !== 'editor') return;

    switch (key.type) {
      case 'enter': {
        this.#editorLines.push('');
        this.render();
        break;
      }
      case 'ctrl+enter': {
        const text = this.#editorLines.join('\n').trim();
        if (!text || !this.#editorResolve) break;
        const resolve = this.#editorResolve;
        this.#editorResolve = null;
        resolve(text);
        break;
      }
      case 'backspace': {
        const last = this.#editorLines[this.#editorLines.length - 1] ?? '';
        if (last.length > 0) {
          this.#editorLines[this.#editorLines.length - 1] = last.slice(0, -1);
        } else if (this.#editorLines.length > 1) {
          this.#editorLines.pop();
        }
        this.render();
        break;
      }
      case 'char': {
        const lastIdx = this.#editorLines.length - 1;
        this.#editorLines[lastIdx] = (this.#editorLines[lastIdx] ?? '') + key.value;
        this.render();
        break;
      }
    }
  }

  #flushToScroll(): void {
    if (this.#flushedCount >= this.#sealedBlocks.length) return;
    const cols = this.#screen.columns;
    let out = '';
    for (let i = this.#flushedCount; i < this.#sealedBlocks.length; i++) {
      const block = this.#sealedBlocks[i]!;
      const emoji = BLOCK_EMOJI[block.type] ?? '';
      const plain = BLOCK_PLAIN[block.type] ?? block.type;
      out += buildDivider(`${emoji}${plain}`, cols) + '\n';
      out += '\n';
      const lines = block.content.split('\n');
      const contentLines = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
      for (const line of contentLines) {
        for (const wrapped of wrapLine(CONTENT_INDENT + line, cols)) {
          out += wrapped + '\n';
        }
      }
      out += '\n';
    }
    this.#flushedCount = this.#sealedBlocks.length;
    this.#screen.exitAltBuffer();
    this.#screen.write(out);
    this.#screen.enterAltBuffer();
  }

  public render(): void {
    const cols = this.#screen.columns;
    const totalRows = this.#screen.rows;

    const toolRows = this.#buildToolRows(cols);
    const toolHeight = toolRows.length;
    const toolSepHeight = toolHeight > 0 ? 1 : 0;

    const contentRows = Math.max(2, totalRows - toolHeight - toolSepHeight);

    // Build all content rows from sealed blocks, active block, and editor
    const allContent: string[] = [];

    for (const block of this.#sealedBlocks) {
      const emoji = BLOCK_EMOJI[block.type] ?? '';
      const plain = BLOCK_PLAIN[block.type] ?? block.type;
      allContent.push(buildDivider(`${emoji}${plain}`, cols));
      allContent.push('');
      const blockLines = block.content.split('\n');
      const trimmedLines = blockLines[blockLines.length - 1] === '' ? blockLines.slice(0, -1) : blockLines;
      for (const line of trimmedLines) {
        allContent.push(...wrapLine(CONTENT_INDENT + line, cols));
      }
      allContent.push('');
    }

    if (this.#activeBlock) {
      allContent.push(buildDivider(BLOCK_PLAIN[this.#activeBlock.type] ?? this.#activeBlock.type, cols));
      allContent.push('');
      const activeEmoji = BLOCK_EMOJI[this.#activeBlock.type] ?? '';
      const activeLines = this.#activeBlock.content.split('\n');
      for (let i = 0; i < activeLines.length; i++) {
        const pfx = i === 0 ? activeEmoji : CONTENT_INDENT;
        allContent.push(...wrapLine(pfx + (activeLines[i] ?? ''), cols));
      }
    }

    if (this.#mode === 'editor') {
      allContent.push(buildDivider(BLOCK_PLAIN['prompt'] ?? 'prompt', cols));
      allContent.push('');
      for (let i = 0; i < this.#editorLines.length; i++) {
        const pfx = i === 0 ? EDITOR_PROMPT : CONTENT_INDENT;
        allContent.push(...wrapLine(pfx + (this.#editorLines[i] ?? ''), cols));
      }
    }

    // Fit to contentRows: take last N rows, pad from top if short
    const overflow = allContent.length - contentRows;
    const visibleRows =
      overflow > 0
        ? allContent.slice(overflow)
        : [...new Array<string>(contentRows - allContent.length).fill(''), ...allContent];

    const toolSepRows = toolHeight > 0 ? [DIM + FILL.repeat(cols) + RESET] : [];
    const allRows = [...visibleRows, ...toolSepRows, ...toolRows];

    let out = syncStart + hideCursor;
    out += cursorAt(1, 1);
    for (let i = 0; i < allRows.length - 1; i++) {
      out += '\r' + clearLine + (allRows[i] ?? '') + '\n';
    }
    out += clearDown;
    const lastRow = allRows[allRows.length - 1];
    if (lastRow !== undefined) {
      out += '\r' + clearLine + lastRow;
    }

    // In editor mode: cursor is at end of last wrapped editor line
    if (this.#mode === 'editor') {
      const lastIdx = this.#editorLines.length - 1;
      const pfx = lastIdx === 0 ? EDITOR_PROMPT : CONTENT_INDENT;
      const lastPrefixed = pfx + (this.#editorLines[lastIdx] ?? '');
      const wrappedLast = wrapLine(lastPrefixed, cols);
      const lastLine = wrappedLast[wrappedLast.length - 1] ?? '';
      const cursorCol = lastLine.length + 1;
      // Editor is always at the last rows of allContent, which maps to last rows of visibleRows
      out += cursorAt(contentRows, cursorCol) + showCursor;
    }

    out += syncEnd;
    this.#screen.write(out);
  }

  #buildToolRows(cols: number): string[] {
    if (this.#pendingTools.length === 0) return [];
    const tool = this.#pendingTools[this.#selectedTool];
    if (!tool) return [];

    const idx = this.#selectedTool + 1;
    const total = this.#pendingTools.length;
    const nav = total > 1 ? ` \u2190 ${idx}/${total} \u2192` : '';
    const expand = this.#toolExpanded ? '[space: collapse]' : '[space: expand]';
    const approval = this.#pendingApprovals.length > 0 ? ' [Y/N]' : '';
    const summary = `${RESET}Tool: ${tool.name}${nav}${approval} ${expand}`;

    const rows: string[] = [summary];
    if (this.#toolExpanded) {
      for (const line of JSON.stringify(tool.input, null, 2).split('\n')) {
        rows.push(...wrapLine(line, cols));
      }
    }

    // Cap at half the screen height to leave room for content
    return rows.slice(0, Math.floor(this.#screen.rows / 2));
  }
}
