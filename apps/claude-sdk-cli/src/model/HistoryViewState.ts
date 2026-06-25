import EventEmitter from 'node:events';
import type { Block } from './ConversationState.js';

type HistoryViewStateEvents = {
  change: [];
};

/** The outline actions — the stable interface the key-map produces (see historyKeyMap). */
export type HistoryAction = 'prev' | 'next' | 'open' | 'close' | 'scroll-up' | 'scroll-down' | 'page-up' | 'page-down' | 'home' | 'end';

export type Focus = { block: number; tool: number | null };

/**
 * The bottom scroll bound for the focused open content: its rendered (wrapped)
 * height minus the visible budget, the value HistoryViewState.apply clamps
 * scrolling to as maxScroll. The height is computed in the model layer
 * (blockLayout's historyContentExtent lays the content out with a plain,
 * count-preserving decorator), so the nav handler sizes the scroll box without
 * reaching into the view.
 */
export type HistoryContentExtent = (block: Block, focus: Focus, cols: number, rows: number) => number;

/** Blocks a page-up/page-down moves the focus on a list. */
const PAGE_BLOCKS = 5;
/** Lines a page-up/page-down slides open content. */
const PAGE_LINES = 10;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(n, hi));
const toolCount = (block: Block | undefined): number => (block?.type === 'tools' ? (block.tools?.length ?? 0) : 0);
const isToolsBlock = (block: Block | undefined): boolean => block?.type === 'tools' && (block.tools?.length ?? 0) > 0;

/**
 * History navigation state for the box-model outline: the focus path (which
 * block, and which tool inside an opened tools block), whether the focused leaf
 * is open to its content, and the scroll offset of that open content.
 *
 * apply() is the sole mutator — the key-map turns a key into an Action and the
 * handler applies it. Indices address ConversationState.sealedBlocks
 * (append-only, so a stored index stays valid). Every move is clamped: a move at
 * a boundary is a no-op and the index never runs past its range. Scrolling
 * clamps at the top (0) here and at the bottom via the `maxScroll` the handler
 * supplies, measured in the model layer by blockLayout's historyContentExtent.
 * Emits change on every mutation so ViewHost repaints while history is on screen.
 */
export class HistoryViewState {
  #focus: Focus = { block: 0, tool: null };
  #contentOpen = false;
  #scrollOffset = 0;
  readonly #emitter = new EventEmitter<HistoryViewStateEvents>();

  public on<K extends keyof HistoryViewStateEvents>(event: K, listener: (...args: HistoryViewStateEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof HistoryViewStateEvents>(event: K, listener: (...args: HistoryViewStateEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  public get focus(): Focus {
    return this.#focus;
  }

  public get contentOpen(): boolean {
    return this.#contentOpen;
  }

  public get scrollOffset(): number {
    return this.#scrollOffset;
  }

  /** Whether up/down scroll (content) or move (list). The key-map reads this. */
  public get mode(): 'list' | 'content' {
    return this.#contentOpen ? 'content' : 'list';
  }

  /**
   * Apply an outline action. `maxScroll` is the largest valid scroll offset for
   * the open content (rendered height minus the visible budget); the handler
   * computes it. It defaults to no bound so callers that never scroll (and the
   * unit tests of list actions) need not supply it.
   */
  public apply(action: HistoryAction, blocks: ReadonlyArray<Block>, maxScroll = Number.POSITIVE_INFINITY): void {
    switch (action) {
      case 'next':
        this.#move(1, blocks);
        break;
      case 'prev':
        this.#move(-1, blocks);
        break;
      case 'page-down':
        this.#contentOpen ? this.#scrollBy(PAGE_LINES, maxScroll) : this.#move(PAGE_BLOCKS, blocks);
        break;
      case 'page-up':
        this.#contentOpen ? this.#scrollBy(-PAGE_LINES, maxScroll) : this.#move(-PAGE_BLOCKS, blocks);
        break;
      case 'home':
        this.#contentOpen ? this.#scrollTo(0, maxScroll) : this.#jump(false, blocks);
        break;
      case 'end':
        this.#contentOpen ? this.#scrollTo(maxScroll, maxScroll) : this.#jump(true, blocks);
        break;
      case 'open':
        this.#openItem(blocks);
        break;
      case 'close':
        this.#closeItem();
        break;
      case 'scroll-down':
        this.#scrollBy(1, maxScroll);
        break;
      case 'scroll-up':
        this.#scrollBy(-1, maxScroll);
        break;
    }
  }

  /** Move focus among items at the current level (blocks, or tools inside an opened tools block). Folds any open content. Clamped: a move at the boundary is a no-op. */
  #move(delta: number, blocks: ReadonlyArray<Block>): void {
    if (this.#focus.tool === null) {
      const next = clamp(this.#focus.block + delta, 0, blocks.length - 1);
      if (next === this.#focus.block) {
        return;
      }
      this.#focus = { block: next, tool: null };
    } else {
      const next = clamp(this.#focus.tool + delta, 0, toolCount(blocks[this.#focus.block]) - 1);
      if (next === this.#focus.tool) {
        return;
      }
      this.#focus = { block: this.#focus.block, tool: next };
    }
    this.#contentOpen = false;
    this.#scrollOffset = 0;
    this.#emitter.emit('change');
  }

  /** Jump to the first (toEnd=false) or last (toEnd=true) item at the current level. Clamped: a no-op when already there. */
  #jump(toEnd: boolean, blocks: ReadonlyArray<Block>): void {
    if (this.#focus.tool === null) {
      if (blocks.length === 0) {
        return;
      }
      const target = toEnd ? blocks.length - 1 : 0;
      if (target === this.#focus.block) {
        return;
      }
      this.#focus = { block: target, tool: null };
    } else {
      const count = toolCount(blocks[this.#focus.block]);
      if (count === 0) {
        return;
      }
      const target = toEnd ? count - 1 : 0;
      if (target === this.#focus.tool) {
        return;
      }
      this.#focus = { block: this.#focus.block, tool: target };
    }
    this.#contentOpen = false;
    this.#scrollOffset = 0;
    this.#emitter.emit('change');
  }

  /** Open one level in: a tools block descends to its first tool; any other focused item opens its content. */
  #openItem(blocks: ReadonlyArray<Block>): void {
    if (this.#contentOpen) {
      return;
    }
    if (this.#focus.tool === null && isToolsBlock(blocks[this.#focus.block])) {
      this.#focus = { block: this.#focus.block, tool: 0 };
    } else {
      this.#contentOpen = true;
    }
    this.#scrollOffset = 0;
    this.#emitter.emit('change');
  }

  /** Close one level out: open content closes first, then an opened tools block folds back to the block list. */
  #closeItem(): void {
    if (this.#contentOpen) {
      this.#contentOpen = false;
    } else if (this.#focus.tool !== null) {
      this.#focus = { block: this.#focus.block, tool: null };
    } else {
      return;
    }
    this.#scrollOffset = 0;
    this.#emitter.emit('change');
  }

  /** Slide open content by delta; no-op unless content is open. Clamped to [0, maxScroll]. */
  #scrollBy(delta: number, maxScroll: number): void {
    this.#scrollTo(this.#scrollOffset + delta, maxScroll);
  }

  /** Set the scroll offset, clamped to [0, maxScroll]; no-op unless content is open. */
  #scrollTo(target: number, maxScroll: number): void {
    if (!this.#contentOpen) {
      return;
    }
    const next = clamp(target, 0, maxScroll);
    if (!Number.isFinite(next) || next === this.#scrollOffset) {
      return;
    }
    this.#scrollOffset = next;
    this.#emitter.emit('change');
  }

  /** Focus the latest block (the bottom), folded. Called on entry so history always opens at the newest block, keeping no focus state across exits. */
  public enterAtLatest(blockCount: number): void {
    this.#focus = { block: Math.max(0, blockCount - 1), tool: null };
    this.#contentOpen = false;
    this.#scrollOffset = 0;
    this.#emitter.emit('change');
  }

  /** Reset to the first block, folded. */
  public reset(): void {
    this.#focus = { block: 0, tool: null };
    this.#contentOpen = false;
    this.#scrollOffset = 0;
    this.#emitter.emit('change');
  }
}
