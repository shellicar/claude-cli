import EventEmitter from 'node:events';
import { Clock, Instant } from '@js-joda/core';
import { sanitiseLoneSurrogates } from '@shellicar/claude-core/sanitise';
import type { ToolEntry } from './ToolObject.js';

type ConversationStateEvents = {
  change: [];
};

export type BlockType = 'prompt' | 'thinking' | 'response' | 'tools' | 'compaction' | 'meta' | 'notice';

export type Block = {
  type: BlockType;
  content: string;
  /** Structured tool entries for a `tools` block; undefined for every other type. The history view reads this; the Primary view renders `content`. */
  tools?: ToolEntry[];
  /**
   * Set when the block is opened via transitionBlock. Absent for blocks added via
   * addBlocks (history replay, startup banner) where no creation instant is available.
   */
  createdAt?: Instant;
  exitedAt?: Instant;
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
  readonly #clock: Clock;
  #promptStartedAt: Instant | null = null;
  readonly #emitter = new EventEmitter<ConversationStateEvents>();

  public constructor(clock: Clock = Clock.systemUTC()) {
    this.#clock = clock;
  }

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
   * Record the instant the session entered idle (editor) mode.
   * Consumed by the next transitionBlock('prompt') call so the prompt block's
   * createdAt reflects when the user started composing, not when they submitted.
   */
  public markPromptStart(): void {
    this.#promptStartedAt = Instant.now(this.#clock);
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
      const sealing = this.#activeBlock;
      this.#sealedBlocks.push({ ...sealing, exitedAt: Instant.now(this.#clock) });
    }
    const createdAt = type === 'prompt' && this.#promptStartedAt !== null ? this.#promptStartedAt : Instant.now(this.#clock);
    this.#promptStartedAt = null;
    this.#activeBlock = { type, content: '', createdAt };
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
   * Append already-sanitised streaming text to the active block. Folding
   * sanitiseLoneSurrogates in here keeps stored content terminal-safe
   * regardless of caller. If there is no active block, opens a `notice` block
   * so the content is never silently dropped.
   */
  public appendStreaming(text: string): void {
    if (!this.#activeBlock) {
      this.#activeBlock = { type: 'notice', content: '', createdAt: Instant.now(this.#clock) };
    }
    this.#activeBlock.content += sanitiseLoneSurrogates(text);
    this.#emitter.emit('change');
  }

  /**
   * Replace active block content from `offset` to the end with `text`.
   * If `offset` equals the current content length, this appends. If `text`
   * is empty, this truncates. No-op if there is no active block.
   */
  public replaceActiveFromOffset(offset: number, text: string): void {
    if (this.#activeBlock) {
      this.#activeBlock.content = this.#activeBlock.content.slice(0, offset) + text;
    }
  }

  /**
   * Replace the entire active block content.
   * Used by AgentMessageHandler.#redrawTools to rebuild the tools region on every
   * tool state change. Sanitises lone surrogates before storing, matching the
   * contract of appendStreaming. No-op if there is no active block.
   */
  public setActiveBlockContent(text: string): void {
    if (this.#activeBlock) {
      this.#activeBlock.content = sanitiseLoneSurrogates(text);
      this.#emitter.emit('change');
    }
  }

  /**
   * Splice a notice line into the active block at the last newline boundary,
   * so streaming content resumes cleanly after the notice.
   *
   * - No active block: opens a `notice` block with the text.
   * - Active block with a `\n`: inserts `text\n` after the last `\n`, so the
   *   partial line being streamed continues after the notice.
   * - Active block with no `\n` yet: appends `\ntext\n` so the notice lands
   *   after the current partial content and streaming continues.
   */
  public spliceNotice(text: string): void {
    const sanitised = sanitiseLoneSurrogates(text);
    if (!this.#activeBlock) {
      this.#activeBlock = { type: 'notice', content: `${sanitised}\n`, createdAt: Instant.now(this.#clock) };
      this.#emitter.emit('change');
      return;
    }
    const content = this.#activeBlock.content;
    const pos = content.lastIndexOf('\n');
    if (pos === -1) {
      this.#activeBlock.content = `${content}\n${sanitised}\n`;
    } else {
      this.#activeBlock.content = `${content.slice(0, pos + 1)}${sanitised}\n${content.slice(pos + 1)}`;
    }
    this.#emitter.emit('change');
  }

  /**
   * Replace the content of the most recent block of the given type, checking
   * the active block first then searching sealed blocks in reverse.
   * Used by AgentMessageHandler to update tool renders after the tools block
   * has been sealed (e.g. during the approval phase).
   */
  public setLastContent(type: BlockType, text: string): void {
    const sanitised = sanitiseLoneSurrogates(text);
    if (this.#activeBlock?.type === type) {
      this.#activeBlock.content = sanitised;
      this.#emitter.emit('change');
      return;
    }
    for (let i = this.#sealedBlocks.length - 1; i >= 0; i--) {
      if (this.#sealedBlocks[i]?.type === type) {
        // biome-ignore lint/style/noNonNullAssertion: checked above
        this.#sealedBlocks[i]!.content = sanitised;
        this.#emitter.emit('change');
        return;
      }
    }
  }

  /**
   * Set the rendered content and the structured tool entries of the most recent
   * `tools` block (active first, then sealed in reverse). Mirrors setLastContent's
   * targeting so results arriving after the block is sealed still update it. The
   * content string is byte-identical to what setLastContent wrote, so the Primary
   * view's tools rendering is unchanged; `tools` is additive, read only by history.
   */
  public setLastTools(content: string, tools: ToolEntry[]): void {
    const sanitised = sanitiseLoneSurrogates(content);
    if (this.#activeBlock?.type === 'tools') {
      this.#activeBlock.content = sanitised;
      this.#activeBlock.tools = tools;
      this.#emitter.emit('change');
      return;
    }
    for (let i = this.#sealedBlocks.length - 1; i >= 0; i--) {
      if (this.#sealedBlocks[i]?.type === 'tools') {
        // biome-ignore lint/style/noNonNullAssertion: checked above
        this.#sealedBlocks[i]!.content = sanitised;
        // biome-ignore lint/style/noNonNullAssertion: checked above
        this.#sealedBlocks[i]!.tools = tools;
        this.#emitter.emit('change');
        return;
      }
    }
  }

  /** Seal the active block if it has content, then clear it. */
  public completeActive(): void {
    if (this.#activeBlock?.content.trim()) {
      const sealing = this.#activeBlock;
      this.#sealedBlocks.push({ ...sealing, exitedAt: Instant.now(this.#clock) });
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
   * command-mode 'n' (new session) intent.
   */
  public clear(): void {
    this.#sealedBlocks = [];
    this.#flushedCount = 0;
    this.#activeBlock = null;
    this.#emitter.emit('change');
  }
}
