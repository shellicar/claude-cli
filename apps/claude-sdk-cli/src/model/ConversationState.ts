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
    return { noop: false, from, sealed };
  }

  /** Append text to the active block. No-op if there is no active block. */
  public appendToActive(text: string): void {
    if (this.#activeBlock) {
      this.#activeBlock.content += text;
    }
  }

  /** Seal the active block if it has content, then clear it. */
  public completeActive(): void {
    if (this.#activeBlock?.content.trim()) {
      this.#sealedBlocks.push(this.#activeBlock);
    }
    this.#activeBlock = null;
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
      return 'active';
    }
    for (let i = this.#sealedBlocks.length - 1; i >= 0; i--) {
      if (this.#sealedBlocks[i]?.type === type) {
        // biome-ignore lint/style/noNonNullAssertion: checked above
        this.#sealedBlocks[i]!.content += text;
        return i;
      }
    }
    return 'miss';
  }

  /** Advance the flush boundary after blocks have been permanently written to scroll. */
  public advanceFlushedCount(to: number): void {
    this.#flushedCount = to;
  }
}
