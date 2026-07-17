import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import type { HistoryMessage } from '@shellicar/claude-core/history/types';
import type { MessageIdentity } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { AuditWriter } from '../src/AuditWriter.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

// AuditWriter now derives its dir as `${fs.homedir()}/.claude/audit`; with the
// fake homedir '/home/user' that is this path.
const AUDIT_DIR = '/home/user/.claude/audit';

// Captures every message projected into the index, so a test can assert on the write-through pair.
class RecordingHistoryWriter extends IHistoryWriter {
  public readonly inserted: HistoryMessage[] = [];
  public insert(message: HistoryMessage): void {
    this.inserted.push(message);
  }
}

// AuditWriter injects IFileSystem and IHistoryWriter, so build it through a container with the fakes.
// The index defaults to a throwaway recorder for the tests that only inspect the audit file.
function buildAuditWriter(fs: IFileSystem, index: IHistoryWriter = new RecordingHistoryWriter()): AuditWriter {
  const services = createServiceCollection();
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(IHistoryWriter).to(IHistoryWriter, () => index);
  services.register(AuditWriter).to(AuditWriter);
  return services.buildProvider().resolve(AuditWriter);
}

// An index writer that always throws, to prove a store failure is swallowed rather than faulting the turn.
class ThrowingHistoryWriter extends IHistoryWriter {
  public insert(): void {
    throw new Error('index unavailable');
  }
}

// The round's identity as QueryRunner mints it: the user's own messageId, the pair's turnId, the query's queryId.
function makeIdentity(): MessageIdentity {
  return { messageId: 'umsg-1', turnId: 'turn-1', queryId: 'query-1', from: { kind: 'human' } };
}

function makeMessage(text = 'Hello'): BetaMessage {
  return {
    id: 'msg_01',
    container: null,
    content: [{ type: 'text', text }],
    context_management: null,
    model: 'claude-sonnet-4-20250514',
    role: 'assistant',
    stop_details: null,
    stop_reason: 'end_turn',
    stop_sequence: null,
    type: 'message',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  } as BetaMessage;
}

function makeUserDelta(text = 'do the thing'): BetaMessageParam {
  return { role: 'user', content: [{ type: 'text', text }] };
}

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

describe('AuditWriter — write', () => {
  it('creates a file at <auditDir>/<id>.jsonl', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-123', undefined, makeMessage());

    await new Promise((r) => setTimeout(r, 10));

    const expected = true;
    const actual = await fs.exists(`${AUDIT_DIR}/conv-123.jsonl`);
    expect(actual).toBe(expected);
  });

  it('appends one line per call', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-1', undefined, makeMessage('first'));
    writer.write('conv-1', undefined, makeMessage('second'));

    await new Promise((r) => setTimeout(r, 10));

    const content = await fs.readFile(`${AUDIT_DIR}/conv-1.jsonl`);
    const expected = 2;
    const actual = content.trimEnd().split('\n').length;
    expect(actual).toBe(expected);
  });

  it('writes each line as valid JSON', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-2', undefined, makeMessage());

    await new Promise((r) => setTimeout(r, 10));

    const content = await fs.readFile(`${AUDIT_DIR}/conv-2.jsonl`);
    const line = content.trimEnd();
    const expected = true;
    const actual = (() => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    })();
    expect(actual).toBe(expected);
  });

  it('accumulates lines in the same file for the same ID', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-same', undefined, makeMessage('one'));
    writer.write('conv-same', undefined, makeMessage('two'));
    writer.write('conv-same', undefined, makeMessage('three'));

    await new Promise((r) => setTimeout(r, 10));

    const content = await fs.readFile(`${AUDIT_DIR}/conv-same.jsonl`);
    const expected = 3;
    const actual = content.trimEnd().split('\n').length;
    expect(actual).toBe(expected);
  });

  it('creates a separate file for each distinct ID', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-a', undefined, makeMessage('alpha'));
    writer.write('conv-b', undefined, makeMessage('beta'));

    await new Promise((r) => setTimeout(r, 10));

    const existsA = await fs.exists(`${AUDIT_DIR}/conv-a.jsonl`);
    const existsB = await fs.exists(`${AUDIT_DIR}/conv-b.jsonl`);
    const expected = true;
    const actual = existsA && existsB;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// stored cost + breakdown
// ---------------------------------------------------------------------------
// makeMessage has cache_creation_input_tokens: null and no cache_creation object;
// model 'claude-sonnet-4-20250514' strips to 'claude-sonnet-4' (input $3/M, output
// $15/M). Reconstruction must yield { fiveMinute: 0, oneHour: 0 }.

describe('AuditWriter — stored cost and breakdown', () => {
  it('stores a numeric costUsd on the written line', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-cost', undefined, makeMessage());
    await new Promise((r) => setTimeout(r, 10));
    const line = JSON.parse((await fs.readFile(`${AUDIT_DIR}/conv-cost.jsonl`)).trimEnd().split('\n').at(-1) as string);
    const expected = true;
    const actual = typeof line.costUsd === 'number';
    expect(actual).toBe(expected);
  });

  it('stores the reconstructed cache-creation breakdown', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-split', undefined, makeMessage());
    await new Promise((r) => setTimeout(r, 10));
    const line = JSON.parse((await fs.readFile(`${AUDIT_DIR}/conv-split.jsonl`)).trimEnd().split('\n').at(-1) as string);
    const expected = { fiveMinute: 0, oneHour: 0 };
    const actual = line.cacheCreation;
    expect(actual).toEqual(expected);
  });

  it('tolerates a message with null cache_creation, pricing input+output only', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-null', undefined, makeMessage());
    await new Promise((r) => setTimeout(r, 10));
    const line = JSON.parse((await fs.readFile(`${AUDIT_DIR}/conv-null.jsonl`)).trimEnd().split('\n').at(-1) as string);
    const expected = (10 * 3 + 20 * 15) / 1_000_000; // sonnet-4: input $3/M, output $15/M
    const actual = line.costUsd;
    expect(actual).toBeCloseTo(expected);
  });
});

// ---------------------------------------------------------------------------
// turn-pair write
// ---------------------------------------------------------------------------

describe('AuditWriter — turn-pair write', () => {
  it('writes two lines for one call', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-pair', makeUserDelta(), makeMessage());
    await new Promise((r) => setTimeout(r, 10));

    const content = await fs.readFile(`${AUDIT_DIR}/conv-pair.jsonl`);
    const expected = 2;
    const actual = content.trimEnd().split('\n').length;
    expect(actual).toBe(expected);
  });

  it('writes the user delta as the first line', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-user', makeUserDelta(), makeMessage());
    await new Promise((r) => setTimeout(r, 10));

    const [first] = (await fs.readFile(`${AUDIT_DIR}/conv-user.jsonl`)).trimEnd().split('\n');
    const expected = 'user';
    const actual = (JSON.parse(first) as { role: string }).role;
    expect(actual).toBe(expected);
  });

  it('writes the assistant response as the second line', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-asst', makeUserDelta(), makeMessage());
    await new Promise((r) => setTimeout(r, 10));

    const [, second] = (await fs.readFile(`${AUDIT_DIR}/conv-asst.jsonl`)).trimEnd().split('\n');
    const expected = 'assistant';
    const actual = (JSON.parse(second) as { role: string }).role;
    expect(actual).toBe(expected);
  });

  it('stamps both lines with one timestamp', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-ts', makeUserDelta(), makeMessage());
    await new Promise((r) => setTimeout(r, 10));

    const [first, second] = (await fs.readFile(`${AUDIT_DIR}/conv-ts.jsonl`)).trimEnd().split('\n');
    const expected = (JSON.parse(second) as { timestamp: string }).timestamp;
    const actual = (JSON.parse(first) as { timestamp: string }).timestamp;
    expect(actual).toBe(expected);
  });

  it('carries the delta content on the user line', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    const delta = makeUserDelta('specific text');
    writer.write('conv-content', delta, makeMessage());
    await new Promise((r) => setTimeout(r, 10));

    const [first] = (await fs.readFile(`${AUDIT_DIR}/conv-content.jsonl`)).trimEnd().split('\n');
    const expected = delta.content;
    const actual = (JSON.parse(first) as { content: unknown }).content;
    expect(actual).toEqual(expected);
  });

  it('writes only the assistant line when the delta is undefined', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-none', undefined, makeMessage());
    await new Promise((r) => setTimeout(r, 10));

    const content = await fs.readFile(`${AUDIT_DIR}/conv-none.jsonl`);
    const expected = 1;
    const actual = content.trimEnd().split('\n').length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// v2 ids on the audit lines (write-model §3)
// ---------------------------------------------------------------------------

describe('AuditWriter — v2 ids on the audit lines', () => {
  it('stamps the user line with the identity ids', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-uv2', makeUserDelta(), makeMessage(), makeIdentity());
    await new Promise((r) => setTimeout(r, 10));

    const [first] = (await fs.readFile(`${AUDIT_DIR}/conv-uv2.jsonl`)).trimEnd().split('\n');
    const line = JSON.parse(first) as { id: string; turnId: string; queryId: string };
    const expected = { id: 'umsg-1', turnId: 'turn-1', queryId: 'query-1' };
    const actual = { id: line.id, turnId: line.turnId, queryId: line.queryId };
    expect(actual).toEqual(expected);
  });

  it('stamps the assistant line with the turn ids, keeping its API id', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-av2', makeUserDelta(), makeMessage(), makeIdentity());
    await new Promise((r) => setTimeout(r, 10));

    const [, second] = (await fs.readFile(`${AUDIT_DIR}/conv-av2.jsonl`)).trimEnd().split('\n');
    const line = JSON.parse(second) as { id: string; turnId: string; queryId: string };
    const expected = { id: 'msg_01', turnId: 'turn-1', queryId: 'query-1' };
    const actual = { id: line.id, turnId: line.turnId, queryId: line.queryId };
    expect(actual).toEqual(expected);
  });

  it('omits the ids on the user line for a legacy round with no identity', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.write('conv-legacy', makeUserDelta(), makeMessage());
    await new Promise((r) => setTimeout(r, 10));

    const [first] = (await fs.readFile(`${AUDIT_DIR}/conv-legacy.jsonl`)).trimEnd().split('\n');
    const expected = false;
    const actual = 'turnId' in (JSON.parse(first) as object);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// index projection (write-model §1: write-through keeps the live index current)
// ---------------------------------------------------------------------------

describe('AuditWriter — index projection', () => {
  it('projects the user message stamped with the conversationId and identity ids', () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const index = new RecordingHistoryWriter();
    const writer = buildAuditWriter(fs, index);
    writer.write('conv-proj', makeUserDelta(), makeMessage(), makeIdentity());

    const user = index.inserted.find((m) => m.role === 'user');
    const expected = { id: 'umsg-1', conversationId: 'conv-proj', turnId: 'turn-1', queryId: 'query-1' };
    const actual = { id: user?.id, conversationId: user?.conversationId, turnId: user?.turnId, queryId: user?.queryId };
    expect(actual).toEqual(expected);
  });

  it('projects the assistant message under its API message id', () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const index = new RecordingHistoryWriter();
    const writer = buildAuditWriter(fs, index);
    writer.write('conv-proj', makeUserDelta(), makeMessage(), makeIdentity());

    const assistant = index.inserted.find((m) => m.role === 'assistant');
    const expected = 'msg_01';
    const actual = assistant?.id;
    expect(actual).toBe(expected);
  });

  it('indexes the user delta text as a searchable block', () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const index = new RecordingHistoryWriter();
    const writer = buildAuditWriter(fs, index);
    writer.write('conv-blocks', makeUserDelta('find me later'), makeMessage(), makeIdentity());

    const user = index.inserted.find((m) => m.role === 'user');
    const expected = [{ seq: 0, type: 'text', text: 'find me later' }];
    const actual = user?.blocks;
    expect(actual).toEqual(expected);
  });

  it('projects both messages of the pair', () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const index = new RecordingHistoryWriter();
    const writer = buildAuditWriter(fs, index);
    writer.write('conv-both', makeUserDelta(), makeMessage(), makeIdentity());

    const expected = 2;
    const actual = index.inserted.length;
    expect(actual).toBe(expected);
  });

  it('does not index a legacy round with no identity', () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const index = new RecordingHistoryWriter();
    const writer = buildAuditWriter(fs, index);
    writer.write('conv-noindex', makeUserDelta(), makeMessage());

    const expected = 0;
    const actual = index.inserted.length;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// best-effort index projection (write-model §1: a store failure must never fault the turn)
// ---------------------------------------------------------------------------

describe('AuditWriter — best-effort index projection', () => {
  it('swallows an index insert failure so the turn is not faulted', () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs, new ThrowingHistoryWriter());

    const act = () => writer.write('conv-throw', makeUserDelta(), makeMessage(), makeIdentity());

    expect(act).not.toThrow();
  });
});
