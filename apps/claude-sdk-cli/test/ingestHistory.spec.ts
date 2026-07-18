import { DatabaseSync } from 'node:sqlite';
import { IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import { SqliteHistoryEngine } from '@shellicar/claude-core/history/SqliteHistoryEngine';
import type { HistoryMessage } from '@shellicar/claude-core/history/types';
import { describe, expect, it } from 'vitest';
import { ingestHistory } from '../scripts/ingestHistory.js';
import { logger } from '../src/logger.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const UUID = '00000000-0000-0000-0000-000000000001';
const AUDIT = `/home/user/.claude/audit/${UUID}.jsonl`;

class RecordingWriter extends IHistoryWriter {
  public readonly inserted: HistoryMessage[] = [];
  public insert(message: HistoryMessage): void {
    this.inserted.push(message);
  }
}

const v2 = (id: string, text: string): string => JSON.stringify({ role: 'assistant', id, turnId: 't1', queryId: 'q1', timestamp: '2026-01-01T00:00:00Z', content: [{ type: 'text', text }] });

const v1 = JSON.stringify({ role: 'assistant', id: 'old', timestamp: '2025-01-01T00:00:00Z', content: [{ type: 'text', text: 'legacy' }] });

const noop = (): void => {};

describe('ingestHistory', () => {
  it('writes each v2 line through and skips v1 lines', async () => {
    const fs = new MemoryFileSystem({ [AUDIT]: `${v1}\n${v2('m1', 'hello')}\n` });
    const writer = new RecordingWriter();

    const expected = { files: 1, inserted: 1, skipped: 1, corrupt: 0 };
    const actual = await ingestHistory(fs, writer, noop);
    expect(actual).toEqual(expected);
  });

  it('stamps each message with the file name stem as the conversationId', async () => {
    const fs = new MemoryFileSystem({ [AUDIT]: `${v2('m1', 'hello')}\n` });
    const writer = new RecordingWriter();
    await ingestHistory(fs, writer, noop);

    const expected = UUID;
    const actual = writer.inserted[0].conversationId;
    expect(actual).toBe(expected);
  });

  it('ignores files that are not audit files', async () => {
    const fs = new MemoryFileSystem({ '/home/user/.claude/audit/notes.txt': 'ignore me' });
    const writer = new RecordingWriter();

    const expected = 0;
    const actual = (await ingestHistory(fs, writer, noop)).files;
    expect(actual).toBe(expected);
  });

  it('returns a zero summary when there is no audit directory', async () => {
    const fs = new MemoryFileSystem({});
    const writer = new RecordingWriter();

    const expected = { files: 0, inserted: 0, skipped: 0, corrupt: 0 };
    const actual = await ingestHistory(fs, writer, noop);
    expect(actual).toEqual(expected);
  });

  it('leaves one row after a repeated run', async () => {
    const fs = new MemoryFileSystem({ [AUDIT]: `${v2('m1', 'hello')}\n` });
    const engine = new SqliteHistoryEngine(new DatabaseSync(':memory:'), logger);
    await ingestHistory(fs, engine, noop);
    await ingestHistory(fs, engine, noop);

    const expected = 1;
    const actual = engine.search({ query: 'hello', limit: 10 }).length;
    expect(actual).toBe(expected);
  });

  it('skips a corrupt line and indexes the rest of the file', async () => {
    const corruptLine = '{ role: "assistant", truncated';
    const fs = new MemoryFileSystem({ [AUDIT]: `${v2('m1', 'hello')}\n${corruptLine}\n${v2('m2', 'world')}\n` });
    const writer = new RecordingWriter();

    const expected = { files: 1, inserted: 2, skipped: 0, corrupt: 1 };
    const actual = await ingestHistory(fs, writer, noop);
    expect(actual).toEqual(expected);
  });
});
