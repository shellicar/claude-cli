import EventEmitter from 'node:events';
import type { ConversationPeek } from '../conversations/scanAuditPeek.js';
import type { AuditSummary } from '../conversations/scanAuditSummary.js';

type ConversationListStateEvents = {
  change: [];
};

/** One row of the conversation view. `summary` is undefined until its audit file has been read, which is
 *  what lets the list paint from the session store alone and fill in behind. */
export type ConversationEntry = {
  id: string;
  summary: AuditSummary | undefined;
};

/** The outline actions the key-map produces (see conversationKeyMap). */
export type ConversationAction = 'prev' | 'next' | 'page-up' | 'page-down' | 'home' | 'end' | 'toggle-peek';

/** Rows a page-up/page-down moves the selection. */
const PAGE_ENTRIES = 5;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(n, hi));

/**
 * The conversation view's state: which conversations exist for this directory, which is selected, and
 * whether the selected one is peeked open.
 *
 * Peek is a flat toggle, not a level: it changes what the selected entry renders and nothing else, so
 * up/down and the page keys always move the selection and never change meaning. That is the whole
 * reason this state is so much smaller than HistoryViewState, which has an open/close level and a
 * tools sub-level to arbitrate.
 *
 * `setEntries` seeds the ids (a synchronous store read); `setSummary` lands each summary as its audit
 * file finishes reading. Every mutation emits change, so ViewHost repaints while the view is on screen.
 */
/** The state's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConversationListState {
  public abstract on<K extends keyof ConversationListStateEvents>(event: K, listener: (...args: ConversationListStateEvents[K]) => void): void;
  public abstract off<K extends keyof ConversationListStateEvents>(event: K, listener: (...args: ConversationListStateEvents[K]) => void): void;
  public abstract get entries(): readonly ConversationEntry[];
  public abstract get selected(): number;
  public abstract get peeked(): boolean;
  /** The open peek's content, undefined while it is still being read. */
  public abstract get peek(): ConversationPeek | undefined;
  public abstract get selectedEntry(): ConversationEntry | undefined;
  public abstract setEntries(ids: readonly string[]): void;
  public abstract setSummary(id: string, summary: AuditSummary): void;
  public abstract setPeek(id: string, peek: ConversationPeek): void;
  public abstract apply(action: ConversationAction): void;
  public abstract enterAt(id: string): void;
  public abstract reset(): void;
}

export class ConversationListState extends IConversationListState {
  #entries: ConversationEntry[] = [];
  #selected = 0;
  #peeked = false;
  #peek: ConversationPeek | undefined;
  /** The conversation the view was opened on, held until it appears in a rebuilt list. */
  #enteredId: string | undefined;
  readonly #emitter = new EventEmitter<ConversationListStateEvents>();

  public on<K extends keyof ConversationListStateEvents>(event: K, listener: (...args: ConversationListStateEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof ConversationListStateEvents>(event: K, listener: (...args: ConversationListStateEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  public get entries(): readonly ConversationEntry[] {
    return this.#entries;
  }

  public get selected(): number {
    return this.#selected;
  }

  public get peeked(): boolean {
    return this.#peeked;
  }

  public get peek(): ConversationPeek | undefined {
    return this.#peek;
  }

  public get selectedEntry(): ConversationEntry | undefined {
    return this.#entries[this.#selected];
  }

  /** Replace the list, keeping the selection on the same conversation where it still exists — entering the
   *  view twice in a row should not silently move what is selected. */
  public setEntries(ids: readonly string[]): void {
    const bySummary = new Map(this.#entries.map((entry) => [entry.id, entry.summary]));
    this.#reorder(
      ids.map((id) => ({ id, summary: bySummary.get(id) })),
      this.#enteredId ?? this.selectedEntry?.id,
    );
    this.#emitter.emit('change');
  }

  /**
   * Orders the list by when each conversation was last active, newest first, and puts the selection back
   * on the conversation it was on.
   *
   * That timestamp is the one the row displays as its age, so the order is the one the operator can see
   * rather than an invisible property like when the session store last recorded the conversation —
   * which switching itself changes, so the list would reorder as a result of being used.
   *
   * A conversation whose summary has not loaded has no timestamp yet and sorts last, so rows settle as
   * their summaries arrive rather than the list waiting to be shown.
   */
  #reorder(entries: ConversationEntry[], keepSelectedId: string | undefined): void {
    const activity = (entry: ConversationEntry): string => entry.summary?.lastUtc ?? '';
    this.#entries = [...entries].sort((left, right) => activity(right).localeCompare(activity(left)));
    const restored = keepSelectedId === undefined ? -1 : this.#entries.findIndex((entry) => entry.id === keepSelectedId);
    this.#selected = restored >= 0 ? restored : 0;
  }

  /** Land the peek's content. Ignores a read that lands after the operator moved on, so a slow peek can
   *  never appear under a conversation it does not belong to. */
  public setPeek(id: string, peek: ConversationPeek): void {
    if (!this.#peeked || this.selectedEntry?.id !== id) {
      return;
    }
    this.#peek = peek;
    this.#emitter.emit('change');
  }

  /** Land a summary against its id. Silently ignores an id no longer listed: a read in flight when the
   *  list is rebuilt lands late, and there is no row for it to fill. */
  public setSummary(id: string, summary: AuditSummary): void {
    const entry = this.#entries.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      return;
    }
    entry.summary = summary;
    this.#reorder(this.#entries, this.selectedEntry?.id);
    this.#emitter.emit('change');
  }

  public apply(action: ConversationAction): void {
    switch (action) {
      case 'next':
        this.#move(1);
        return;
      case 'prev':
        this.#move(-1);
        return;
      case 'page-down':
        this.#move(PAGE_ENTRIES);
        return;
      case 'page-up':
        this.#move(-PAGE_ENTRIES);
        return;
      case 'home':
        this.#moveTo(0);
        return;
      case 'end':
        this.#moveTo(this.#entries.length - 1);
        return;
      case 'toggle-peek':
        this.#togglePeek();
        return;
    }
  }

  /** Move the selection, clamped: a move at either boundary is a no-op. */
  #move(delta: number): void {
    this.#moveTo(this.#selected + delta);
  }

  /** A move keeps the peek open and drops only its content, so moving down a peeked list peeks each
   *  conversation in turn rather than folding shut on the first move. The content belongs to the
   *  conversation that was selected, so it goes; the loader fills the new one in. */
  #moveTo(target: number): void {
    if (this.#entries.length === 0) {
      return;
    }
    // Moving is the operator choosing a row, which supersedes where entry put them.
    this.#enteredId = undefined;
    const next = clamp(target, 0, this.#entries.length - 1);
    if (next === this.#selected) {
      return;
    }
    this.#selected = next;
    this.#peek = undefined;
    this.#emitter.emit('change');
  }

  #togglePeek(): void {
    if (this.#entries.length === 0) {
      return;
    }
    this.#peeked = !this.#peeked;
    this.#peek = undefined;
    this.#emitter.emit('change');
  }

  /**
   * Opens the view on a given conversation, folded — the one the process is on, so entry lands where the
   * operator already is rather than at the top of the list.
   *
   * Records the id rather than an index: the list is rebuilt and reordered on entry, and the entries are
   * seeded before their summaries decide the order, so an index chosen now would address a different
   * conversation a moment later.
   */
  public enterAt(id: string): void {
    this.#enteredId = id;
    this.#peeked = false;
    this.#peek = undefined;
    const found = this.#entries.findIndex((entry) => entry.id === id);
    this.#selected = found >= 0 ? found : 0;
    this.#emitter.emit('change');
  }

  /** Back to the newest conversation, folded. */
  public reset(): void {
    this.#enteredId = undefined;
    this.#selected = 0;
    this.#peeked = false;
    this.#peek = undefined;
    this.#emitter.emit('change');
  }
}
