import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { type Clock, Instant } from '@js-joda/core';
import { IHistorySweeper } from '@shellicar/claude-core/history/interfaces';
import { type DedupConfig, lshBuckets, minhashSignature, nearDuplicateClusters, shingles } from '@shellicar/claude-core/history/dedup';
import type { HistorySweepResult } from '@shellicar/claude-core/history/types';

/** How one sweep pass is bounded and tuned. The dedup numbers are the sweep's own first guesses, tunable without a re-index. */
export type HistorySweepConfig = DedupConfig & {
  /** How many new messages one pass processes, so a large backlog is drained over several passes rather than one long lock. */
  batchSize: number;
  /** How long a taken lease is held before it is treated as abandoned, in seconds. */
  leaseSeconds: number;
};

// bands 16 × rows 8 puts the LSH candidate threshold near 0.7, matched by the confirm threshold; shingleSize 5 asks
// for a five-word verbatim run before two messages start to look alike. These are the sweep's numbers, not the SC's.
export const DEFAULT_HISTORY_SWEEP_CONFIG: HistorySweepConfig = {
  shingleSize: 5,
  hashCount: 128,
  bands: 16,
  threshold: 0.7,
  batchSize: 500,
  leaseSeconds: 300,
};

type BatchRow = { rowid: number; id: string; text: string };
type BlockRow = { rowid: number; text: string };

/**
 * The dedup sweep over the history index (write-model's sweep, Phase 6). One `sweep` pass takes the store-wide lease,
 * looks at the messages added since the watermark, folds each near-duplicate into the earliest copy it matches, and
 * advances the watermark. It shares `history.db` with the engine; the schema it uses (the lease/watermark row, the
 * band buckets, the duplicate links) is migration 1.1 on that store.
 *
 * Near-duplicate, not exact: the engine already drops exact `id` repeats, but a fleet dispatch leaves many copies of
 * one turn, each a distinct message. This matches them by content (shingles → MinHash → LSH, in claude-core/dedup),
 * collapses a cluster to its canonical row, and drops the others from the FTS mirror — their full rows stay, so a
 * collapsed copy is still readable by its citation; it just no longer floods search.
 *
 * There is no cross-CLI coordination beyond the lease row: a second CLI whose pass overlaps this one finds the lease
 * held and does nothing (`ran: false`). A CLI that dies mid-pass frees the lease when its expiry passes.
 */
export class SqliteHistorySweeper extends IHistorySweeper {
  readonly #db: DatabaseSync;
  readonly #clock: Clock;
  readonly #config: HistorySweepConfig;
  // This process's lease owner id: stable for the engine's life, so a renewal or release recognises its own lease.
  readonly #owner = randomUUID();

  readonly #state: StatementSync;
  readonly #takeLease: StatementSync;
  readonly #releaseLease: StatementSync;
  readonly #batch: StatementSync;
  readonly #textOf: StatementSync;
  readonly #candidatesByBucket: StatementSync;
  readonly #insertBand: StatementSync;
  readonly #deleteBands: StatementSync;
  readonly #linkDuplicate: StatementSync;
  readonly #canonicalOf: StatementSync;
  readonly #ftsBlocks: StatementSync;
  readonly #deleteFromFts: StatementSync;
  readonly #setWatermark: StatementSync;

  public constructor(db: DatabaseSync, clock: Clock, config: HistorySweepConfig = DEFAULT_HISTORY_SWEEP_CONFIG) {
    super();
    this.#db = db;
    this.#clock = clock;
    this.#config = config;

    this.#state = this.#db.prepare('SELECT lease_owner AS owner, lease_expires AS expires, watermark AS watermark FROM sweep_state WHERE id = 1');
    this.#takeLease = this.#db.prepare('UPDATE sweep_state SET lease_owner = ?, lease_expires = ? WHERE id = 1');
    this.#releaseLease = this.#db.prepare('UPDATE sweep_state SET lease_owner = NULL, lease_expires = NULL WHERE id = 1');
    // The next batch of messages past the watermark, in rowid order (which is chronological). Their searchable text is
    // the text-bearing blocks joined; a message with no such block is excluded here and only advances the watermark.
    this.#batch = this.#db.prepare(
      `SELECT m.rowid AS rowid, m.id AS id, group_concat(b.text, ' ') AS text
       FROM messages m JOIN blocks b ON b.message_id = m.id
       WHERE m.rowid > ? AND b.text IS NOT NULL AND length(b.text) > 0
       GROUP BY m.id
       ORDER BY m.rowid
       LIMIT ?`,
    );
    this.#textOf = this.#db.prepare(
      `SELECT group_concat(text, ' ') AS text FROM blocks WHERE message_id = ? AND text IS NOT NULL AND length(text) > 0`,
    );
    this.#candidatesByBucket = this.#db.prepare('SELECT DISTINCT message_id AS id FROM signature_bands WHERE bucket = ?');
    this.#insertBand = this.#db.prepare('INSERT INTO signature_bands (message_id, bucket) VALUES (?, ?)');
    this.#deleteBands = this.#db.prepare('DELETE FROM signature_bands WHERE message_id = ?');
    this.#linkDuplicate = this.#db.prepare('INSERT OR IGNORE INTO message_duplicates (duplicate_id, canonical_id) VALUES (?, ?)');
    this.#canonicalOf = this.#db.prepare('SELECT canonical_id AS canonical FROM message_duplicates WHERE duplicate_id = ?');
    this.#ftsBlocks = this.#db.prepare('SELECT rowid AS rowid, text AS text FROM blocks WHERE message_id = ? AND text IS NOT NULL AND length(text) > 0');
    // The external-content FTS5 delete command: hand back the rowid and the exact text that was indexed.
    this.#deleteFromFts = this.#db.prepare("INSERT INTO blocks_fts (blocks_fts, rowid, text) VALUES ('delete', ?, ?)");
    this.#setWatermark = this.#db.prepare('UPDATE sweep_state SET watermark = ? WHERE id = 1');
  }

  public sweep(): HistorySweepResult {
    const watermark = this.#acquire();
    if (watermark === null) {
      return { ran: false, scanned: 0, collapsed: 0 };
    }
    const batch = this.#batch.all(watermark, this.#config.batchSize) as BatchRow[];
    if (batch.length === 0) {
      this.#release(watermark);
      return { ran: true, scanned: 0, collapsed: 0 };
    }

    const collapsed = this.#deduplicate(batch);
    const newWatermark = batch[batch.length - 1].rowid;
    this.#release(newWatermark);
    return { ran: true, scanned: batch.length, collapsed };
  }

  // Take the lease if it is free or already ours or expired, returning the watermark to resume from; null if another
  // CLI holds a live lease. BEGIN IMMEDIATE makes the read-and-claim atomic against a second CLI doing the same.
  #acquire(): number | null {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.#state.get() as { owner: string | null; expires: string | null; watermark: number };
      const now = Instant.now(this.#clock).toString();
      const held = row.owner !== null && row.owner !== this.#owner && row.expires !== null && row.expires > now;
      if (held) {
        this.#db.exec('COMMIT');
        return null;
      }
      this.#takeLease.run(this.#owner, Instant.now(this.#clock).plusSeconds(this.#config.leaseSeconds).toString());
      this.#db.exec('COMMIT');
      return row.watermark;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  #release(watermark: number): void {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#setWatermark.run(watermark);
      this.#releaseLease.run();
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  // Fold the batch's near-duplicates into their canonical rows and record every surviving new message's buckets.
  // Returns how many new messages were collapsed.
  #deduplicate(batch: readonly BatchRow[]): number {
    const newIds = new Set(batch.map((row) => row.id));
    const bucketsByNew = new Map<string, string[]>();
    const candidateIds = new Set<string>();
    for (const row of batch) {
      const buckets = lshBuckets(minhashSignature(shingles(row.text, this.#config.shingleSize), this.#config.hashCount), this.#config.bands);
      bucketsByNew.set(row.id, buckets);
      for (const bucket of buckets) {
        for (const candidate of this.#candidatesByBucket.all(bucket) as Array<{ id: string }>) {
          if (!newIds.has(candidate.id)) {
            candidateIds.add(candidate.id);
          }
        }
      }
    }

    // Existing candidates precede the new batch (lower rowid); ordering them first makes the canonical of any cluster
    // the earliest copy. A candidate whose text has since gone is skipped — it can no longer be a match target.
    const existing = [...candidateIds]
      .map((id) => ({ id, text: (this.#textOf.get(id) as { text: string | null }).text }))
      .filter((item): item is { id: string; text: string } => item.text !== null);
    const items = [...existing, ...batch.map((row) => ({ id: row.id, text: row.text }))];
    const clusters = nearDuplicateClusters(items, this.#config);
    const collapsedIds = new Set<string>();

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      for (const cluster of clusters) {
        const canonical = this.#resolveCanonical(cluster.canonicalId);
        for (const duplicateId of cluster.duplicateIds) {
          // Only ever collapse a new message. An existing canonical stays; a pre-existing near-duplicate the batch
          // happens to surface is left alone, because it was already the canonical of its own cluster when swept.
          if (newIds.has(duplicateId)) {
            this.#collapse(duplicateId, canonical);
            collapsedIds.add(duplicateId);
          }
        }
      }
      // A surviving new message keeps its buckets so a later pass can match a future copy against it.
      for (const [id, buckets] of bucketsByNew) {
        if (!collapsedIds.has(id)) {
          for (const bucket of buckets) {
            this.#insertBand.run(id, bucket);
          }
        }
      }
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
    return collapsedIds.size;
  }

  // Follow a duplicate link to the ultimate canonical, so a copy of a copy folds into the original, not the middle row.
  #resolveCanonical(id: string): string {
    let current = id;
    for (let hop = this.#canonicalOf.get(current) as { canonical: string } | undefined; hop !== undefined; hop = this.#canonicalOf.get(current) as { canonical: string } | undefined) {
      current = hop.canonical;
    }
    return current;
  }

  // Link the duplicate to its canonical and drop its blocks from the FTS mirror. The message and its blocks stay, so
  // it is still readable by citation; only its buckets go, since a collapsed row is no longer a match target.
  #collapse(duplicateId: string, canonicalId: string): void {
    this.#linkDuplicate.run(duplicateId, canonicalId);
    for (const block of this.#ftsBlocks.all(duplicateId) as BlockRow[]) {
      this.#deleteFromFts.run(block.rowid, block.text);
    }
    this.#deleteBands.run(duplicateId);
  }
}
