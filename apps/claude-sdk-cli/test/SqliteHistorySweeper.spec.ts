import { DatabaseSync } from 'node:sqlite';
import { Clock, Instant, ZoneId } from '@js-joda/core';
import type { HistoryBlock, HistoryMessage, HistoryRole } from '@shellicar/claude-core/history/types';
import { describe, expect, it } from 'vitest';
import { SqliteHistoryEngine } from '../src/persistence/SqliteHistoryEngine.js';
import { type HistorySweepConfig, SqliteHistorySweeper } from '../src/persistence/SqliteHistorySweeper.js';

const CONFIG: HistorySweepConfig = { shingleSize: 3, hashCount: 64, bands: 16, threshold: 0.7, batchSize: 500, leaseSeconds: 300 };

// Enough words to shingle, and identical across copies so the signatures match exactly.
const DUP_TEXT = 'the quick brown fox jumps over the lazy dog in the meadow';

function fixedClock(iso = '2026-01-01T00:00:00Z'): Clock {
  return Clock.fixed(Instant.parse(iso), ZoneId.UTC);
}

function block(type: string, text: string | null, seq = 0): HistoryBlock {
  return { seq, type, text };
}

function msg(id: string, turnId: string, timestamp: string, blocks: HistoryBlock[], role: HistoryRole = 'assistant', conversationId = 'c1'): HistoryMessage {
  return { id, conversationId, turnId, queryId: 'q1', timestamp, role, blocks };
}

function harness(clock: Clock = fixedClock()) {
  const db = new DatabaseSync(':memory:');
  const engine = new SqliteHistoryEngine(db);
  const sweeper = new SqliteHistorySweeper(db, clock, CONFIG);
  return { db, engine, sweeper };
}

describe('SqliteHistorySweeper — deduplication', () => {
  it('collapses a near-identical copy', () => {
    const { engine, sweeper } = harness();
    engine.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', [block('text', DUP_TEXT)]));
    engine.insert(msg('m2', 't2', '2026-01-01T00:01:00Z', [block('text', DUP_TEXT)]));

    const expected = 1;
    const actual = sweeper.sweep().collapsed;

    expect(actual).toBe(expected);
  });

  it('leaves the canonical searchable and drops the duplicate from search', () => {
    const { engine, sweeper } = harness();
    engine.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', [block('text', DUP_TEXT)]));
    engine.insert(msg('m2', 't2', '2026-01-01T00:01:00Z', [block('text', DUP_TEXT)]));
    sweeper.sweep();

    const expected = ['t1'];
    const actual = engine.search({ query: 'meadow', limit: 10 }).map((hit) => hit.turnId);

    expect(actual).toEqual(expected);
  });

  it('keeps the collapsed duplicate readable by its citation', () => {
    const { engine, sweeper } = harness();
    engine.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', [block('text', DUP_TEXT)]));
    engine.insert(msg('m2', 't2', '2026-01-01T00:01:00Z', [block('text', DUP_TEXT)]));
    sweeper.sweep();

    const expected = [DUP_TEXT];
    const actual = engine.read({ citations: [{ conversationId: 'c1', turnId: 't2' }], window: 0 })[0].events.map((event) => event.text);

    expect(actual).toEqual(expected);
  });

  it('does not collapse unrelated messages', () => {
    const { engine, sweeper } = harness();
    engine.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', [block('text', DUP_TEXT)]));
    engine.insert(msg('m2', 't2', '2026-01-01T00:01:00Z', [block('text', 'entirely different content sharing none of the same words at all here')]));

    const expected = 0;
    const actual = sweeper.sweep().collapsed;

    expect(actual).toBe(expected);
  });

  it('collapses a copy that arrives in a later pass, matched against the stored corpus', () => {
    const { engine, sweeper } = harness();
    engine.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', [block('text', DUP_TEXT)]));
    sweeper.sweep();
    engine.insert(msg('m2', 't2', '2026-01-01T00:01:00Z', [block('text', DUP_TEXT)]));

    const expected = 1;
    const actual = sweeper.sweep().collapsed;

    expect(actual).toBe(expected);
  });
});

describe('SqliteHistorySweeper — watermark', () => {
  it('does not reconsider a message a previous pass already swept', () => {
    const { engine, sweeper } = harness();
    engine.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', [block('text', DUP_TEXT)]));
    sweeper.sweep();

    const expected = 0;
    const actual = sweeper.sweep().scanned;

    expect(actual).toBe(expected);
  });

  it('reports the number of new messages a pass scanned', () => {
    const { engine, sweeper } = harness();
    engine.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', [block('text', DUP_TEXT)]));
    engine.insert(msg('m2', 't2', '2026-01-01T00:01:00Z', [block('text', 'wholly separate prose about something else entirely and unrelated now')]));

    const expected = 2;
    const actual = sweeper.sweep().scanned;

    expect(actual).toBe(expected);
  });
});

describe('SqliteHistorySweeper — lease', () => {
  it('does not run while another CLI holds a live lease', () => {
    const { db, engine, sweeper } = harness();
    engine.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', [block('text', DUP_TEXT)]));
    db.exec("UPDATE sweep_state SET lease_owner = 'other', lease_expires = '2999-01-01T00:00:00Z' WHERE id = 1");

    const expected = false;
    const actual = sweeper.sweep().ran;

    expect(actual).toBe(expected);
  });

  it('takes over a lease whose expiry has passed', () => {
    const { db, engine, sweeper } = harness();
    engine.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', [block('text', DUP_TEXT)]));
    db.exec("UPDATE sweep_state SET lease_owner = 'other', lease_expires = '2000-01-01T00:00:00Z' WHERE id = 1");

    const expected = true;
    const actual = sweeper.sweep().ran;

    expect(actual).toBe(expected);
  });

  it('frees the lease when a pass finishes', () => {
    const { db, engine, sweeper } = harness();
    engine.insert(msg('m1', 't1', '2026-01-01T00:00:00Z', [block('text', DUP_TEXT)]));
    sweeper.sweep();

    const expected = null;
    const actual = (db.prepare('SELECT lease_owner AS owner FROM sweep_state WHERE id = 1').get() as { owner: string | null }).owner;

    expect(actual).toBe(expected);
  });
});
