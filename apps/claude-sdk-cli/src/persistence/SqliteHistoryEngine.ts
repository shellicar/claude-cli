import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { IHistoryReader, IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import { toFtsMatch } from '@shellicar/claude-core/history/search';
import { DEFAULT_HISTORY_TYPE_WEIGHTS, type HistoryEvent, type HistoryMessage, type HistoryReadRequest, type HistoryRole, type HistorySearchHit, type HistorySearchQuery, type HistoryTypeWeights, type HistoryWindow } from '@shellicar/claude-core/history/types';
import { type Migration, migrate, schemaVersion } from './migrate.js';

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
      // The conversation a message belongs to, timestamp-ordered: the citation's `session`, and the seam Phase 5
      // orders a conversation's turns over to derive the numeric `turn`.
      db.exec('CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, timestamp);');
      db.exec('CREATE INDEX IF NOT EXISTS messages_ts ON messages(timestamp);');
    },
  },
];

type SearchRow = { conversationId: string; turnId: string; timestamp: string; role: HistoryRole; type: string; snippet: string; weightedRank: number };
type EventRow = { timestamp: string; role: HistoryRole; type: string; text: string | null };

/**
 * The history index behind both seams. Write (`insert`) dedups on the message id — drop-on-conflict, never an
 * update — and lands a message and its blocks in one transaction. Read (`search`, `read`) runs bm25 full-text
 * search with per-type weighting applied at query time, and opens a window of events around a turn citation.
 *
 * The block text lives once, in `blocks`, mirrored into an external-content FTS5 table for search. The engine takes
 * a `DatabaseSync` (from `DatabaseFactory` under DI, or a raw open from the standalone ingest) and brings the schema
 * up to this build on construction.
 */
export class SqliteHistoryEngine implements IHistoryReader, IHistoryWriter {
  readonly #db: DatabaseSync;
  readonly #weights: HistoryTypeWeights;
  readonly #insertMessage: StatementSync;
  readonly #insertBlock: StatementSync;
  readonly #insertFts: StatementSync;
  readonly #turnTimestamp: StatementSync;
  readonly #turnsBefore: StatementSync;
  readonly #turnsAfter: StatementSync;
  readonly #turnEvents: StatementSync;

  public constructor(db: DatabaseSync, weights: HistoryTypeWeights = DEFAULT_HISTORY_TYPE_WEIGHTS) {
    this.#db = db;
    this.#weights = weights;
    this.#db.exec('PRAGMA busy_timeout = 5000');
    this.#db.exec('PRAGMA synchronous = NORMAL');
    this.#db.exec('PRAGMA journal_mode = WAL');
    migrate(this.#db, HISTORY_MIGRATIONS, 'history');

    this.#insertMessage = this.#db.prepare('INSERT OR IGNORE INTO messages (id, conversation_id, turn_id, query_id, timestamp, role) VALUES (?, ?, ?, ?, ?, ?)');
    this.#insertBlock = this.#db.prepare('INSERT INTO blocks (message_id, seq, type, text) VALUES (?, ?, ?, ?)');
    this.#insertFts = this.#db.prepare('INSERT INTO blocks_fts (rowid, text) VALUES (?, ?)');
    this.#turnTimestamp = this.#db.prepare('SELECT MIN(timestamp) AS ts, conversation_id AS conversationId FROM messages WHERE turn_id = ?');
    this.#turnsBefore = this.#db.prepare('SELECT turn_id FROM messages WHERE timestamp <= ? GROUP BY turn_id ORDER BY MIN(timestamp) DESC, turn_id DESC LIMIT ?');
    this.#turnsAfter = this.#db.prepare('SELECT turn_id FROM messages WHERE timestamp > ? GROUP BY turn_id ORDER BY MIN(timestamp) ASC, turn_id ASC LIMIT ?');
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
    params.push(query.limit);
    // bm25() is more-negative for a better match; the per-type weight multiplies it (a bigger weight ranks a type
    // higher), so ORDER BY weightedRank ASC still puts the best first. The weight is applied here, not in the index.
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
    return request.citations.map((turnId) => this.#window(turnId, request.window));
  }

  #window(turnId: string, window: number): HistoryWindow {
    const center = this.#turnTimestamp.get(turnId) as { ts: string | null; conversationId: string | null };
    if (center.ts === null) {
      return { conversationId: '', turnId, events: [] };
    }
    // `before` includes the centre turn (timestamp <= centre) and up to `window` turns before it, newest-first;
    // reversing gives chronological order. `after` is the turns strictly after, already chronological.
    const before = (this.#turnsBefore.all(center.ts, window + 1) as Array<{ turn_id: string }>).map((row) => row.turn_id).reverse();
    const after = (this.#turnsAfter.all(center.ts, window) as Array<{ turn_id: string }>).map((row) => row.turn_id);
    const events: HistoryEvent[] = [];
    for (const tid of [...before, ...after]) {
      for (const row of this.#turnEvents.all(tid) as EventRow[]) {
        events.push({ turnId: tid, timestamp: row.timestamp, role: row.role, type: row.type, text: this.#cap(row.text) });
      }
    }
    return { conversationId: center.conversationId ?? '', turnId, events };
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
