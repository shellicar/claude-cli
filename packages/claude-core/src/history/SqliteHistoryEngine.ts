import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { ILogger } from '../logging/ILogger';
import { type Migration, migrate, schemaVersion } from '../persistence/migrate';
import type { IHistoryReader, IHistoryWriter } from './interfaces';
import { toFtsMatch } from '../search';
import { DEFAULT_HISTORY_TYPE_WEIGHTS, type HistoryEvent, type HistoryMessage, type HistoryReadRequest, type HistoryRole, type HistorySearchHit, type HistorySearchQuery, type HistoryTypeWeights, type HistoryWindow } from './types';

// One event's text is capped so a single giant tool_result can't flood a read window's context.
const EVENT_TEXT_CAP = 2000;

// ~40-token snippet window around the match — enough to pick a hit, not to judge it.
const SNIPPET_TOKENS = 40;

// The store's schema, versioned via PRAGMA user_version (see migrate.ts and CLAUDE.md "Database Schema & Migrations").
// Append a new entry for every change; never edit a shipped one.
const HISTORY_MIGRATIONS: readonly Migration[] = [
  {
    version: schemaVersion(1, 0),
    apply: (db) => {
      // One row per message; `id` is the ONLY dedup key (write-model §2).
      db.exec(
        `CREATE TABLE IF NOT EXISTS messages (
          id              TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          turn_id         TEXT NOT NULL,
          query_id        TEXT NOT NULL,
          timestamp       TEXT NOT NULL,
          role            TEXT NOT NULL
        );`,
      );
      // The message's content blocks; no key of their own — blocks are never deduped, the message id gates them.
      db.exec(
        `CREATE TABLE IF NOT EXISTS blocks (
          message_id TEXT NOT NULL REFERENCES messages(id),
          seq        INTEGER NOT NULL,
          type       TEXT NOT NULL,
          text       TEXT
        );`,
      );
      // External-content FTS5 over block text: the index mirrors blocks.text without a second copy, and the sweep
      // (Phase 6) can drop a collapsed duplicate from the mirror while keeping the block row readable by citation.
      // CREATE VIRTUAL TABLE … USING fts5 also doubles as the earliest-signal check that FTS5 is present on this Node.
      db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
          text,
          content = 'blocks',
          content_rowid = 'rowid',
          tokenize = 'porter unicode61'
        );`,
      );
      db.exec('CREATE INDEX IF NOT EXISTS blocks_message ON blocks(message_id);');
      db.exec('CREATE INDEX IF NOT EXISTS messages_turn ON messages(turn_id);');
      // The conversation a message belongs to, timestamp-ordered: the citation's `session`, and the index the read
      // window walks to take the turns either side of a cited `turnId` within that one conversation.
      db.exec('CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, timestamp);');
      db.exec('CREATE INDEX IF NOT EXISTS messages_ts ON messages(timestamp);');
    },
  },
  {
    // Phase 6 (the sweep). Additive/minor: new tables only, so an older build keeps operating this store unchanged.
    version: schemaVersion(1, 1),
    apply: (db) => {
      // One row (id = 1) holds the sweep's lease and watermark for the whole store; there is no coordination
      // between CLIs beyond this row. `watermark` is the highest messages.rowid a pass has processed; the lease is
      // an owner id and an ISO expiry, so a CLI that dies mid-pass frees the lease when the expiry passes.
      db.exec(
        `CREATE TABLE IF NOT EXISTS sweep_state (
          id            INTEGER PRIMARY KEY CHECK (id = 1),
          lease_owner   TEXT,
          lease_expires TEXT,
          watermark     INTEGER NOT NULL DEFAULT 0
        );`,
      );
      db.exec('INSERT OR IGNORE INTO sweep_state (id, watermark) VALUES (1, 0);');
      // Each searchable message's LSH band buckets: the sweep queries this by bucket to find the near-duplicate
      // candidates of a new message without scanning the corpus. A collapsed duplicate is removed from here (it is no
      // longer a match target), so only canonical/unique messages keep buckets.
      db.exec(
        `CREATE TABLE IF NOT EXISTS signature_bands (
          message_id TEXT NOT NULL REFERENCES messages(id),
          bucket     TEXT NOT NULL
        );`,
      );
      db.exec('CREATE INDEX IF NOT EXISTS signature_bands_bucket ON signature_bands(bucket);');
      db.exec('CREATE INDEX IF NOT EXISTS signature_bands_message ON signature_bands(message_id);');
      // A collapsed duplicate linked to the canonical row it folds into. The duplicate's message and blocks stay,
      // so it is still readable by its citation; it is only dropped from the FTS mirror so search returns the
      // canonical once instead of every copy.
      db.exec(
        `CREATE TABLE IF NOT EXISTS message_duplicates (
          duplicate_id TEXT PRIMARY KEY REFERENCES messages(id),
          canonical_id TEXT NOT NULL REFERENCES messages(id)
        );`,
      );
    },
  },
];

type SearchRow = { conversationId: string; turnId: string; timestamp: string; role: HistoryRole; type: string; snippet: string; weightedRank: number };
type EventRow = { timestamp: string; role: HistoryRole; type: string; text: string | null };

/**
 * The history index behind both seams. Write (`insert`, the IHistoryWriter seam) dedups on the message id —
 * drop-on-conflict, never an update — and lands a message and its blocks in one transaction. Read (`search`,
 * `read`, the IHistoryReader seam) runs bm25 full-text search with per-type weighting applied at query time, and
 * opens a window of events around a turn citation.
 *
 * The block text lives once, in `blocks`, mirrored into an external-content FTS5 table for search. The engine takes
 * a `DatabaseSync` (from a caller's own factory, e.g. the CLI's `DatabaseFactory` under DI, an MCP server opening
 * the store read-only, or the standalone ingest) and brings the schema up to this build on construction.
 */
export class SqliteHistoryEngine implements IHistoryReader, IHistoryWriter {
  readonly #db: DatabaseSync;
  readonly #weights: HistoryTypeWeights;
  readonly #insertMessage: StatementSync;
  readonly #insertBlock: StatementSync;
  readonly #insertFts: StatementSync;
  readonly #windowTurns: StatementSync;
  readonly #turnEvents: StatementSync;

  public constructor(db: DatabaseSync, logger: ILogger, weights: HistoryTypeWeights = DEFAULT_HISTORY_TYPE_WEIGHTS) {
    this.#db = db;
    this.#weights = weights;
    this.#db.exec('PRAGMA busy_timeout = 5000');
    this.#db.exec('PRAGMA synchronous = NORMAL');
    this.#db.exec('PRAGMA journal_mode = WAL');
    migrate(this.#db, HISTORY_MIGRATIONS, 'history', logger);

    this.#insertMessage = this.#db.prepare('INSERT OR IGNORE INTO messages (id, conversation_id, turn_id, query_id, timestamp, role) VALUES (?, ?, ?, ?, ?, ?)');
    this.#insertBlock = this.#db.prepare('INSERT INTO blocks (message_id, seq, type, text) VALUES (?, ?, ?, ?)');
    this.#insertFts = this.#db.prepare('INSERT INTO blocks_fts (rowid, text) VALUES (?, ?)');
    // The turns of one conversation within `window` positions of the cited turn, that conversation's turns ordered
    // by timestamp (ties by turn_id). Scoped to the one conversation (write-model §6): the window never reaches
    // across into another session's turns, and ordering a single conversation is cheap where numbering the whole
    // corpus was not.
    this.#windowTurns = this.#db.prepare(
      `WITH ordered AS (
         SELECT turn_id, ROW_NUMBER() OVER (ORDER BY MIN(timestamp) ASC, turn_id ASC) AS pos
         FROM messages WHERE conversation_id = ? GROUP BY turn_id
       ),
       centre AS (SELECT pos FROM ordered WHERE turn_id = ?)
       SELECT o.turn_id AS turnId FROM ordered o, centre c
       WHERE o.pos BETWEEN c.pos - ? AND c.pos + ?
       ORDER BY o.pos`,
    );
    this.#turnEvents = this.#db.prepare(
      `SELECT m.timestamp AS timestamp, m.role AS role, b.type AS type, b.text AS text
       FROM messages m JOIN blocks b ON b.message_id = m.id
       WHERE m.turn_id = ?
       ORDER BY CASE m.role WHEN 'user' THEN 0 ELSE 1 END, b.seq`,
    );
  }

  public insert(message: HistoryMessage): void {
    // Message + blocks land atomically, gated by whether the message id was new. A duplicate id inserts nothing —
    // no message row, so no blocks, so the FTS mirror never doubles up either. Run again and it is a no-op.
    this.#transaction(() => {
      const info = this.#insertMessage.run(message.id, message.conversationId, message.turnId, message.queryId, message.timestamp, message.role);
      if (info.changes === 0) {
        return;
      }
      for (const block of message.blocks) {
        const blockInfo = this.#insertBlock.run(message.id, block.seq, block.type, block.text);
        // Only text-bearing blocks go into the full-text index; a block with no text is stored but not searchable.
        if (block.text !== null && block.text.length > 0) {
          this.#insertFts.run(blockInfo.lastInsertRowid, block.text);
        }
      }
    });
  }

  public search(query: HistorySearchQuery): HistorySearchHit[] {
    const match = toFtsMatch(query.query);
    if (match === null) {
      return [];
    }
    const params: Array<string | number> = [match];
    let filters = '';
    if (query.role !== undefined) {
      filters += ' AND m.role = ?';
      params.push(query.role);
    }
    if (query.type !== undefined) {
      filters += ' AND b.type = ?';
      params.push(query.type);
    }
    if (query.since !== undefined) {
      filters += ' AND m.timestamp >= ?';
      params.push(query.since);
    }
    if (query.until !== undefined) {
      filters += ' AND m.timestamp <= ?';
      params.push(query.until);
    }
    if (query.excludeConversationId !== undefined) {
      filters += ' AND m.conversation_id <> ?';
      params.push(query.excludeConversationId);
    }
    params.push(query.limit);
    // bm25() is more-negative for a better match; the per-type weight multiplies it (a bigger weight ranks a type
    // higher), so ORDER BY weightedRank ASC still puts the best first. The weight is applied here, not in the index.
    // The hit carries the store's own turn_id — the caller round-trips it to read; no ordinal is computed.
    const stmt = this.#db.prepare(
      `SELECT m.conversation_id AS conversationId, m.turn_id AS turnId, m.timestamp AS timestamp, m.role AS role, b.type AS type,
              snippet(blocks_fts, 0, '', '', '…', ${SNIPPET_TOKENS}) AS snippet,
              bm25(blocks_fts) * ${this.#weightCase()} AS weightedRank
       FROM blocks_fts
       JOIN blocks b ON b.rowid = blocks_fts.rowid
       JOIN messages m ON m.id = b.message_id
       WHERE blocks_fts MATCH ?${filters}
       ORDER BY weightedRank ASC
       LIMIT ?`,
    );
    const rows = stmt.all(...params) as SearchRow[];
    return rows.map((row) => ({ conversationId: row.conversationId, turnId: row.turnId, timestamp: row.timestamp, role: row.role, type: row.type, snippet: row.snippet, score: -row.weightedRank }));
  }

  public read(request: HistoryReadRequest): HistoryWindow[] {
    return request.citations.map((citation) => this.#window(citation.conversationId, citation.turnId, request.window));
  }

  // The window is the turns of this one conversation within `window` positions of the cited `turnId`, that
  // conversation's turns ordered by timestamp. Scoping by conversation is the point (write-model §6): a citation
  // opens its own session, never a slice that reaches across into another's turns — and ordering one conversation
  // is cheap, where numbering the whole corpus was not. An unknown conversation or turnId matches nothing, so the
  // window comes back empty on the cited coordinates.
  #window(conversationId: string, turnId: string, window: number): HistoryWindow {
    const turns = this.#windowTurns.all(conversationId, turnId, window, window) as Array<{ turnId: string }>;
    const events: HistoryEvent[] = [];
    for (const row of turns) {
      for (const event of this.#turnEvents.all(row.turnId) as EventRow[]) {
        events.push({ turnId: row.turnId, timestamp: event.timestamp, role: event.role, type: event.type, text: this.#cap(event.text) });
      }
    }
    return { conversationId, turnId, events };
  }

  // A CASE mapping each configured type to its weight, defaulting an unknown type to 1.0. The weights are the
  // engine's own numbers (from config, not user input), so they are formatted straight into the query.
  #weightCase(): string {
    const arms = Object.entries(this.#weights).map(([type, weight]) => `WHEN ${quote(type)} THEN ${Number(weight)}`);
    return `CASE b.type ${arms.join(' ')} ELSE 1.0 END`;
  }

  #cap(text: string | null): string {
    if (text === null) {
      return '';
    }
    return text.length <= EVENT_TEXT_CAP ? text : `${text.slice(0, EVENT_TEXT_CAP)}…`;
  }

  #transaction<T>(fn: () => T): T {
    // BEGIN IMMEDIATE takes the write lock upfront, so a second writer waits (busy_timeout) rather than failing
    // partway through the multi-statement insert.
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }
}

const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
