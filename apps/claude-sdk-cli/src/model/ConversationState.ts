import EventEmitter from 'node:events';
import { sanitiseLoneSurrogates } from '@shellicar/claude-core/sanitise';

type ConversationStateEvents = {
  change: [];
};

export type BlockType = 'prompt' | 'thinking' | 'response' | 'tools' | 'compaction' | 'meta';

export type Block = {
  type: BlockType;
  content: string;
};

export type TransitionResult = {
  noop: boolean;
  from: BlockType | null;
  sealed: boolean;
};

/**
 * Pure state for the conversation display: sealed blocks, the active streaming block,
 * and the flush boundary (how many sealed blocks have been permanently written to scroll).
 *
 * No rendering, no I/O. Methods take the state to a new state and return enough
 * information for the caller to log or react to the transition.
 */
export class ConversationState {
  #sealedBlocks: Block[] = [];
  #flushedCount = 0;
  #activeBlock: Block | null = null;
  readonly #emitter = new EventEmitter<ConversationStateEvents>();

  public on<K extends keyof ConversationStateEvents>(event: K, listener: (...args: ConversationStateEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof ConversationStateEvents>(event: K, listener: (...args: ConversationStateEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  public get sealedBlocks(): ReadonlyArray<Block> {
    return this.#sealedBlocks;
  }

  public get flushedCount(): number {
    return this.#flushedCount;
  }

  public get activeBlock(): Block | null {
    return this.#activeBlock;
  }

  /** Push one or more pre-built blocks (e.g. from history replay or startup banner). */
  public addBlocks(blocks: ReadonlyArray<Block>): void {
    for (const block of blocks) {
      this.#sealedBlocks.push(block);
    }
    this.#emitter.emit('change');
  }

  /**
   * Seal the current active block (if non-empty) and open a new one of the given type.
   *
   * Returns metadata so the caller can log appropriately:
   * - `noop: true`  — same type was already active, nothing changed
   * - `noop: false` — transition happened; `from` is the previous type (null if none),
   *                   `sealed` is true if the previous block had content and was sealed
   */
  public transitionBlock(type: BlockType): TransitionResult {
    if (this.#activeBlock?.type === type) {
      return { noop: true, from: type, sealed: false };
    }
    const from = this.#activeBlock?.type ?? null;
    const sealed = !!this.#activeBlock?.content.trim();
    if (this.#activeBlock?.content.trim()) {
      this.#sealedBlocks.push(this.#activeBlock);
    }
    this.#activeBlock = { type, content: '' };
    this.#emitter.emit('change');
    return { noop: false, from, sealed };
  }

  /** Append text to the active block. No-op if there is no active block. */
  public appendToActive(text: string): void {
    if (this.#activeBlock) {
      this.#activeBlock.content += text;
      this.#emitter.emit('change');
    }
  }

  /**
   * Append already-sanitised streaming text to the active block. AppLayout
   * wrapped every appendStreaming call site with sanitiseLoneSurrogates;
   * folding it in here keeps stored content terminal-safe regardless of caller.
   */
  public appendStreaming(text: string): void {
    if (this.#activeBlock) {
      this.#activeBlock.content += sanitiseLoneSurrogates(text);
      this.#emitter.emit('change');
    }
  }

  /** Seal the active block if it has content, then clear it. */
  public completeActive(): void {
    if (this.#activeBlock?.content.trim()) {
      this.#sealedBlocks.push(this.#activeBlock);
    }
    this.#activeBlock = null;
    this.#emitter.emit('change');
  }

  /**
   * Append text to the most recent block of the given type, checking the active block
   * first then searching sealed blocks in reverse. Used for retroactive annotations.
   *
   * Returns:
   * - `'active'`    — text was appended to the active block
   * - a number      — text was appended to the sealed block at that index
   * - `'miss'`      — no matching block found, text was not appended
   */
  public appendToLastSealed(type: BlockType, text: string): 'active' | number | 'miss' {
    if (this.#activeBlock?.type === type) {
      this.#activeBlock.content += text;
      this.#emitter.emit('change');
      return 'active';
    }
    for (let i = this.#sealedBlocks.length - 1; i >= 0; i--) {
      if (this.#sealedBlocks[i]?.type === type) {
        // biome-ignore lint/style/noNonNullAssertion: checked above
        this.#sealedBlocks[i]!.content += text;
        this.#emitter.emit('change');
        return i;
      }
    }
    return 'miss';
  }

  /** Advance the flush boundary after blocks have been permanently written to scroll. */
  public advanceFlushedCount(to: number): void {
    this.#flushedCount = to;
    // No emit: the scroll write already happened; rendered content is unchanged.
  }

  /**
   * Replace internal state with a fresh empty conversation. Used by the
   * command-mode 'n' (new session) intent. Replaces AppLayout's pattern of
   * reassigning the #conversationState field, which does not work when several
   * holders share the reference.
   */
  public clear(): void {
    this.#sealedBlocks = [];
    this.#flushedCount = 0;
    this.#activeBlock = null;
    this.#emitter.emit('change');
  }
}
