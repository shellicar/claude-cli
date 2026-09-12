import { randomUUID } from 'node:crypto';
import EventEmitter from 'node:events';
import { Clock, Instant } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { sanitiseLoneSurrogates } from '@shellicar/claude-core/sanitise';
import { dependsOn } from '@shellicar/core-di';
import { settledCodeTexts } from './markdown/markdownLayout.js';
import type { ToolEntry } from './ToolObject.js';

type ConversationStateEvents = {
  change: [];
};

export type BlockType = 'prompt' | 'thinking' | 'response' | 'tools' | 'execution' | 'compaction' | 'meta' | 'notice';

/**
 * How often a still-streaming block is re-parsed to look for code blocks that have settled.
 *
 * Without a period this runs once per delta, and each run parses the whole block, so the cost
 * of a long answer grows with the square of its length. Nothing needs the fence noticed on the
 * delta that closed it: the affordance cannot appear before the next paint anyway, and the seal
 * settles everything unconditionally. The value only has to be short enough that the latency it
 * adds before an icon appears goes unnoticed.
 */
const FENCE_SETTLE_MS = 120;

/**
 * A code block whose content has settled, and the identity a click on its copy affordance
 * resolves to. Minted once and never reissued, so the same fence is the same target in
 * every frame that draws it.
 */
export type FenceRecord = {
  id: string;
  text: string;
};

export type Block = {
  /**
   * Minted when the block is created and carried through the seal. A frame is rebuilt whole
   * on every paint, so this is what lets a press and a release two frames apart agree on
   * what was clicked.
   */
  id: string;
  type: BlockType;
  content: string;
  /**
   * The settled code blocks within `content`, in the order a render draws them. Grows as
   * fences close and never shrinks. Only `response` blocks are drawn as markdown, so only
   * they have any.
   */
  fences?: FenceRecord[];
  /** Structured tool entries for a `tools` block; undefined for every other type. The history view reads this; the Primary view renders `content`. */
  tools?: ToolEntry[];
  /**
   * Set when the block is opened via transitionBlock. Absent for blocks added via
   * addBlocks (history replay, startup banner) where no creation instant is available.
   */
  createdAt?: Instant;
  exitedAt?: Instant;
};

/** A block as a caller supplies it: the store mints the id and discovers the fences. */
export type NewBlock = Omit<Block, 'id' | 'fences'>;

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
/** The state's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConversationState {
  public abstract on<K extends keyof ConversationStateEvents>(event: K, listener: (...args: ConversationStateEvents[K]) => void): void;
  public abstract off<K extends keyof ConversationStateEvents>(event: K, listener: (...args: ConversationStateEvents[K]) => void): void;
  public abstract get sealedBlocks(): ReadonlyArray<Block>;
  public abstract get flushedCount(): number;
  public abstract get activeBlock(): Block | null;
  public abstract get promptStartedAt(): Instant | null;
  public abstract addBlocks(blocks: ReadonlyArray<NewBlock>): void;
  public abstract markPromptStart(): void;
  public abstract transitionBlock(type: BlockType): TransitionResult;
  public abstract appendToActive(text: string): void;
  public abstract appendStreaming(text: string): void;
  public abstract replaceActiveFromOffset(offset: number, text: string): void;
  public abstract setActiveBlockContent(text: string): void;
  public abstract spliceNotice(text: string): void;
  public abstract setLastContent(type: BlockType, text: string): void;
  public abstract setLastTools(type: 'tools' | 'execution', content: string, tools: ToolEntry[]): void;
  public abstract completeActive(): void;
  public abstract appendToLastSealed(type: BlockType, text: string): 'active' | 'miss';
  public abstract advanceFlushedCount(to: number): void;
  public abstract clear(): void;
}

export class ConversationState extends IConversationState {
  #sealedBlocks: Block[] = [];
  #flushedCount = 0;
  @dependsOn(ILogger) private readonly logger!: ILogger;
  #activeBlock: Block | null = null;
  @dependsOn(Clock) private readonly clock!: Clock;
  #promptStartedAt: Instant | null = null;
  readonly #lastSettleMillis = new WeakMap<Block, number>();
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

  /**
   * The instant the prompt was entered (set by markPromptStart), or null once
   * consumed by transitionBlock('prompt'). The view reads this so the active
   * prompt divider can show its start when entered, like every other block.
   */
  public get promptStartedAt(): Instant | null {
    return this.#promptStartedAt;
  }

  /**
   * Push one or more pre-built blocks (e.g. from history replay or startup banner). Marks them as
   * already flushed: these are re-displays of past content or boot-time notices, not new turn
   * content, so they must not be re-written to scrollback.
   */
  public addBlocks(blocks: ReadonlyArray<NewBlock>): void {
    for (const block of blocks) {
      const added: Block = { ...block, id: randomUUID() };
      this.#settleFences(added, true);
      this.#sealedBlocks.push(added);
    }
    this.#flushedCount = this.#sealedBlocks.length;
    this.#emitter.emit('change');
  }

  /**
   * Record the instant the session entered idle (editor) mode.
   * Consumed by the next transitionBlock('prompt') call so the prompt block's
   * createdAt reflects when the user started composing, not when they submitted.
   */
  public markPromptStart(): void {
    this.#promptStartedAt = Instant.now(this.clock);
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
      this.#seal(this.#activeBlock);
    }
    const createdAt = type === 'prompt' && this.#promptStartedAt !== null ? this.#promptStartedAt : Instant.now(this.clock);
    this.#promptStartedAt = null;
    this.#activeBlock = { id: randomUUID(), type, content: '', createdAt };
    this.#emitter.emit('change');
    return { noop: false, from, sealed };
  }

  /** Append text to the active block. No-op if there is no active block. */
  public appendToActive(text: string): void {
    if (this.#activeBlock) {
      this.#activeBlock.content += text;
      this.#settleFences(this.#activeBlock, false);
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
      this.#activeBlock = { id: randomUUID(), type: 'notice', content: '', createdAt: Instant.now(this.clock) };
    }
    this.#activeBlock.content += sanitiseLoneSurrogates(text);
    this.#settleFences(this.#activeBlock, false);
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
      this.#settleFences(this.#activeBlock, false);
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
      this.#settleFences(this.#activeBlock, false);
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
      this.#activeBlock = { id: randomUUID(), type: 'notice', content: `${sanitised}\n`, createdAt: Instant.now(this.clock) };
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
    this.#settleFences(this.#activeBlock, false);
    this.#emitter.emit('change');
  }

  /**
   * Replace the content of the active block if its type matches. A sealed block is never
   * modified — once sealed, a block's content is final, so a mismatch (or no active block)
   * is a no-op, logged as a warning since it means a caller targeted a block that already closed.
   */
  public setLastContent(type: BlockType, text: string): void {
    const sanitised = sanitiseLoneSurrogates(text);
    if (this.#activeBlock?.type === type) {
      this.#activeBlock.content = sanitised;
      this.#settleFences(this.#activeBlock, false);
      this.#emitter.emit('change');
      return;
    }
    this.logger.warn('setLastContent: no active block of matching type; sealed blocks are never modified', { type });
  }

  /**
   * Set the rendered content and the structured tool entries of the active `tools`/`execution`
   * block if its type matches. A sealed block is never modified — a mismatch (or no active
   * block) is a no-op, logged as a warning since it means a caller targeted a block that
   * already closed.
   */
  public setLastTools(type: 'tools' | 'execution', content: string, tools: ToolEntry[]): void {
    const sanitised = sanitiseLoneSurrogates(content);
    if (this.#activeBlock?.type === type) {
      this.#activeBlock.content = sanitised;
      this.#activeBlock.tools = tools;
      this.#emitter.emit('change');
      return;
    }
    this.logger.warn('setLastTools: no active block of matching type; sealed blocks are never modified', { type });
  }

  /**
   * Close a block off and file it. Sealing is the last thing that happens to its content, so
   * every code block in it has settled by definition, including a fence the response left
   * unclosed: nothing more is coming to close it.
   */
  #seal(block: Block): void {
    const sealed: Block = { ...block, exitedAt: Instant.now(this.clock) };
    this.#settleFences(sealed, true);
    this.#sealedBlocks.push(sealed);
  }

  /**
   * Give an identity to any code block that has settled since the last look.
   *
   * Ids are minted once and never revisited, so the records already held have to still line up
   * with the order a render walks them in. That holds while content only grows, since a fence
   * that has closed cannot reopen. `replaceActiveFromOffset` and `setActiveBlockContent` can
   * shorten or replace it and would break the alignment; neither has a caller today.
   *
   * The period is held per block, so a block that has just opened is looked at straight away
   * rather than waiting out the one before it. Sealing always looks, whatever the period: it is
   * the last chance, and what it finds is final. The streaming path is the only one that reads
   * the clock.
   */
  #settleFences(block: Block, final: boolean): void {
    if (block.type !== 'response') {
      return;
    }
    if (!final) {
      const now = this.clock.millis();
      const last = this.#lastSettleMillis.get(block);
      if (last !== undefined && now - last < FENCE_SETTLE_MS) {
        return;
      }
      this.#lastSettleMillis.set(block, now);
    }
    const texts = settledCodeTexts(block.content, final);
    const held = block.fences ?? [];
    if (texts.length <= held.length) {
      return;
    }
    block.fences = [...held, ...texts.slice(held.length).map((text) => ({ id: randomUUID(), text }))];
  }

  /** Seal the active block if it has content, then clear it. */
  public completeActive(): void {
    if (this.#activeBlock?.content.trim()) {
      this.#seal(this.#activeBlock);
    }
    this.#activeBlock = null;
    this.#emitter.emit('change');
  }

  /**
   * Append text to the active block if its type matches. A sealed block is never modified —
   * once sealed, a block's content is final.
   *
   * Returns:
   * - `'active'` — text was appended to the active block
   * - `'miss'`   — no matching active block, text was not appended (logged as a warning)
   */
  public appendToLastSealed(type: BlockType, text: string): 'active' | 'miss' {
    if (this.#activeBlock?.type === type) {
      this.#activeBlock.content += text;
      this.#settleFences(this.#activeBlock, false);
      this.#emitter.emit('change');
      return 'active';
    }
    this.logger.warn('appendToLastSealed: no active block of matching type; sealed blocks are never modified', { type });
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
