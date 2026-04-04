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

const ESC = '\x1B[';
const cursorAt = (row: number, col: number) => `${ESC}${row};${col}H`;
const clearLine = `${ESC}2K`;
const clearDown = `${ESC}J`;
const showCursor = `${ESC}?25h`;
const hideCursor = `${ESC}?25l`;
const syncStart = '\x1B[?2026h';
const syncEnd = '\x1B[?2026l';
const DIM = '\x1B[2m';
const RESET = '\x1B[0m';

function wrapContent(content: string, cols: number): string[] {
  if (!content) return [];
  const result: string[] = [];
  for (const line of content.split('\n')) {
    result.push(...wrapLine(line, cols));
  }
  return result;
}

export class AppLayout implements Disposable {
  readonly #screen: Screen;
  readonly #cleanupResize: () => void;

  #mode: Mode = 'editor';
  #previousContent = '';
  #activeContent = '';
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

  /** Transition to streaming mode. Previous zone shows the submitted prompt. */
  public startStreaming(prompt: string): void {
    this.#previousContent = prompt;
    this.#mode = 'streaming';
    this.#activeContent = '';
    this.render();
  }

  /** Append a chunk of streaming text to the active zone. */
  public appendStreaming(text: string): void {
    this.#activeContent += sanitiseLoneSurrogates(text);
    this.render();
  }

  /** Move completed response to previous zone and return to editor mode. */
  public completeStreaming(): void {
    this.#previousContent = this.#activeContent;
    this.#activeContent = '';
    this.#pendingTools = [];
    this.#mode = 'editor';
    this.#editorLines = [''];
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

  public render(): void {
    const cols = this.#screen.columns;
    const totalRows = this.#screen.rows;

    const toolRows = this.#buildToolRows(cols);
    const toolHeight = toolRows.length;
    const toolSepHeight = toolHeight > 0 ? 1 : 0;

    // Content area split 50/50; at least 2 rows total to stay usable
    const contentRows = Math.max(2, totalRows - 1 - toolHeight - toolSepHeight);
    const prevZoneHeight = Math.floor(contentRows / 2);
    const activeZoneHeight = contentRows - prevZoneHeight;

    // Previous zone: wrap and show last N lines (truncate from top)
    const prevLines = wrapContent(this.#previousContent, cols);
    const prevZone: string[] =
      prevLines.length <= prevZoneHeight
        ? [...prevLines, ...new Array<string>(prevZoneHeight - prevLines.length).fill('')]
        : prevLines.slice(prevLines.length - prevZoneHeight);

    // Separator
    const sep = DIM + '\u2500'.repeat(cols) + RESET;

    // Active zone
    const activeSource = this.#mode === 'editor' ? this.#editorLines.join('\n') : this.#activeContent;
    const activeLines = wrapContent(activeSource, cols);
    const activeZone: string[] =
      activeLines.length <= activeZoneHeight
        ? [...activeLines, ...new Array<string>(activeZoneHeight - activeLines.length).fill('')]
        : activeLines.slice(activeLines.length - activeZoneHeight);

    const toolSepRows = toolHeight > 0 ? [DIM + '\u2500'.repeat(cols) + RESET] : [];

    const allRows = [...prevZone, sep, ...activeZone, ...toolSepRows, ...toolRows];

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

    // In editor mode: show and position cursor at end of typed content
    if (this.#mode === 'editor') {
      const wrapped = wrapContent(this.#editorLines.join('\n'), cols);
      const contentLineCount = Math.max(1, wrapped.length);
      const cursorRowInActive = Math.min(contentLineCount - 1, activeZoneHeight - 1);
      const lastLine = wrapped[wrapped.length - 1] ?? '';
      // prevZoneHeight rows + 1 separator row + cursorRowInActive offset, all 1-based
      const cursorRow = prevZoneHeight + 1 + cursorRowInActive + 1;
      const cursorCol = lastLine.length + 1;
      out += cursorAt(cursorRow, cursorCol) + showCursor;
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
