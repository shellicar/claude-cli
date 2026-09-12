import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import type { HistoryMessage } from '@shellicar/claude-core/history/types';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { AuditWriter } from '../src/AuditWriter.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

// AuditWriter derives its dir as `${fs.homedir()}/.claude/audit`; with the fake homedir
// '/home/user' that is this path.
const AUDIT_DIR = '/home/user/.claude/audit';

const QUERY_ID = 'query-1';
const TURN_ID = 'turn-1';
const USER_ID = 'umsg-1';
const ASSISTANT_ID = 'amsg-1';

// Captures every message projected into the index, so a test can assert on the write-through.
class RecordingHistoryWriter extends IHistoryWriter {
  public readonly inserted: HistoryMessage[] = [];
  public insert(message: HistoryMessage): void {
    this.inserted.push(message);
  }
}

// AuditWriter injects IFileSystem and IHistoryWriter, so build it through a container with the fakes.
// The index defaults to a throwaway recorder for the tests that only inspect the audit file.
function buildAuditWriter(fs: IFileSystem, index: IHistoryWriter = new RecordingHistoryWriter()): AuditWriter {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IFileSystem)
    .using(() => fs)
    .asSelf();
  services
    .register(IHistoryWriter)
    .using(() => index)
    .asSelf();
  services.register(AuditWriter).asSelf();
  return services.buildProvider().resolve(AuditWriter);
}

// An index writer that always throws, to prove a store failure is swallowed rather than faulting the turn.
class ThrowingHistoryWriter extends IHistoryWriter {
  public insert(): void {
    throw new Error('index unavailable');
  }
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

function makeUserMessage(text = 'do the thing'): BetaMessageParam {
  return { role: 'user', content: [{ type: 'text', text }] };
}

async function linesOf(fs: MemoryFileSystem, conversationId: string): Promise<string[]> {
  // The append is fire-and-forget inside the writer, so let it land before reading.
  await new Promise((r) => setTimeout(r, 10));
  return (await fs.readFile(`${AUDIT_DIR}/${conversationId}.jsonl`)).trimEnd().split('\n');
}

describe('AuditWriter — the audit file', () => {
  it('creates a file at <auditDir>/<id>.jsonl', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    buildAuditWriter(fs).writeAssistant('conv-123', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    await new Promise((r) => setTimeout(r, 10));

    const expected = true;
    const actual = await fs.exists(`${AUDIT_DIR}/conv-123.jsonl`);
    expect(actual).toBe(expected);
  });

  it('appends one line per message', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.writeUser('conv-1', makeUserMessage(), USER_ID, QUERY_ID, TURN_ID);
    writer.writeAssistant('conv-1', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    const expected = 2;
    const actual = (await linesOf(fs, 'conv-1')).length;
    expect(actual).toBe(expected);
  });

  it('writes each line as valid JSON', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    buildAuditWriter(fs).writeAssistant('conv-2', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    const [line] = await linesOf(fs, 'conv-2');
    const act = () => JSON.parse(line as string);
    expect(act).not.toThrow();
  });

  it('accumulates lines in the same file for the same conversation', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.writeAssistant('conv-same', makeMessage('one'), 'a-1', QUERY_ID, TURN_ID);
    writer.writeAssistant('conv-same', makeMessage('two'), 'a-2', QUERY_ID, TURN_ID);
    writer.writeAssistant('conv-same', makeMessage('three'), 'a-3', QUERY_ID, TURN_ID);

    const expected = 3;
    const actual = (await linesOf(fs, 'conv-same')).length;
    expect(actual).toBe(expected);
  });

  it('creates a separate file for each conversation', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs);
    writer.writeAssistant('conv-a', makeMessage('alpha'), ASSISTANT_ID, QUERY_ID, TURN_ID);
    writer.writeAssistant('conv-b', makeMessage('beta'), ASSISTANT_ID, QUERY_ID, TURN_ID);

    await new Promise((r) => setTimeout(r, 10));

    const expected = true;
    const actual = (await fs.exists(`${AUDIT_DIR}/conv-a.jsonl`)) && (await fs.exists(`${AUDIT_DIR}/conv-b.jsonl`));
    expect(actual).toBe(expected);
  });
});

describe('AuditWriter — writeUser', () => {
  it('writes a user-role line', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    buildAuditWriter(fs).writeUser('conv-u', makeUserMessage(), USER_ID, QUERY_ID, TURN_ID);

    const [line] = await linesOf(fs, 'conv-u');
    const expected = 'user';
    const actual = (JSON.parse(line as string) as { role: string }).role;
    expect(actual).toBe(expected);
  });

  it('stamps the line with the message, turn and query ids', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    buildAuditWriter(fs).writeUser('conv-uids', makeUserMessage(), USER_ID, QUERY_ID, TURN_ID);

    const [line] = await linesOf(fs, 'conv-uids');
    const parsed = JSON.parse(line as string) as { id: string; turnId: string; queryId: string };
    const expected = { id: USER_ID, turnId: TURN_ID, queryId: QUERY_ID };
    const actual = { id: parsed.id, turnId: parsed.turnId, queryId: parsed.queryId };
    expect(actual).toEqual(expected);
  });

  it('carries the message content', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const message = makeUserMessage('specific text');
    buildAuditWriter(fs).writeUser('conv-ucontent', message, USER_ID, QUERY_ID, TURN_ID);

    const [line] = await linesOf(fs, 'conv-ucontent');
    const expected = message.content;
    const actual = (JSON.parse(line as string) as { content: unknown }).content;
    expect(actual).toEqual(expected);
  });

  // The reason the write is per-message: a query cancelled during its tools commits a tool_result
  // message and then ends, so no assistant response ever follows it.
  it('records a user message that no assistant response follows', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    buildAuditWriter(fs).writeUser('conv-cancelled', makeUserMessage('tool results'), USER_ID, QUERY_ID, TURN_ID);

    const expected = 1;
    const actual = (await linesOf(fs, 'conv-cancelled')).length;
    expect(actual).toBe(expected);
  });
});

describe('AuditWriter — writeAssistant', () => {
  it('writes an assistant-role line', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    buildAuditWriter(fs).writeAssistant('conv-a', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    const [line] = await linesOf(fs, 'conv-a');
    const expected = 'assistant';
    const actual = (JSON.parse(line as string) as { role: string }).role;
    expect(actual).toBe(expected);
  });

  it('identifies the message by its minted id, not the API response id', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    buildAuditWriter(fs).writeAssistant('conv-aid', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    const [line] = await linesOf(fs, 'conv-aid');
    const expected = ASSISTANT_ID;
    const actual = (JSON.parse(line as string) as { id: string }).id;
    expect(actual).toBe(expected);
  });

  it('keeps the API response id alongside it', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    buildAuditWriter(fs).writeAssistant('conv-api', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    const [line] = await linesOf(fs, 'conv-api');
    const expected = 'msg_01';
    const actual = (JSON.parse(line as string) as { apiMessageId: string }).apiMessageId;
    expect(actual).toBe(expected);
  });

  it('stamps the line with the turn and query ids', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    buildAuditWriter(fs).writeAssistant('conv-aids', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    const [line] = await linesOf(fs, 'conv-aids');
    const parsed = JSON.parse(line as string) as { turnId: string; queryId: string };
    const expected = { turnId: TURN_ID, queryId: QUERY_ID };
    const actual = { turnId: parsed.turnId, queryId: parsed.queryId };
    expect(actual).toEqual(expected);
  });
});

// makeMessage has cache_creation_input_tokens: null and no cache_creation object; model
// 'claude-sonnet-4-20250514' strips to 'claude-sonnet-4' (input $3/M, output $15/M).
// Reconstruction must yield { fiveMinute: 0, oneHour: 0 }.
describe('AuditWriter — stored cost and breakdown', () => {
  it('stores a numeric costUsd on the assistant line', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    buildAuditWriter(fs).writeAssistant('conv-cost', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    const [line] = await linesOf(fs, 'conv-cost');
    const expected = true;
    const actual = typeof (JSON.parse(line as string) as { costUsd: unknown }).costUsd === 'number';
    expect(actual).toBe(expected);
  });

  it('stores the reconstructed cache-creation breakdown', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    buildAuditWriter(fs).writeAssistant('conv-split', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    const [line] = await linesOf(fs, 'conv-split');
    const expected = { fiveMinute: 0, oneHour: 0 };
    const actual = (JSON.parse(line as string) as { cacheCreation: unknown }).cacheCreation;
    expect(actual).toEqual(expected);
  });

  it('tolerates a message with null cache_creation, pricing input+output only', async () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    buildAuditWriter(fs).writeAssistant('conv-null', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    const [line] = await linesOf(fs, 'conv-null');
    const expected = (10 * 3 + 20 * 15) / 1_000_000; // sonnet-4: input $3/M, output $15/M
    const actual = (JSON.parse(line as string) as { costUsd: number }).costUsd;
    expect(actual).toBeCloseTo(expected);
  });
});

describe('AuditWriter — index projection', () => {
  it('projects the user message stamped with the conversation and round ids', () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const index = new RecordingHistoryWriter();
    buildAuditWriter(fs, index).writeUser('conv-proj', makeUserMessage(), USER_ID, QUERY_ID, TURN_ID);

    const user = index.inserted.find((m) => m.role === 'user');
    const expected = { id: USER_ID, conversationId: 'conv-proj', turnId: TURN_ID, queryId: QUERY_ID };
    const actual = { id: user?.id, conversationId: user?.conversationId, turnId: user?.turnId, queryId: user?.queryId };
    expect(actual).toEqual(expected);
  });

  it('projects the assistant message under the same id the audit line carries', () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const index = new RecordingHistoryWriter();
    buildAuditWriter(fs, index).writeAssistant('conv-proj', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    const assistant = index.inserted.find((m) => m.role === 'assistant');
    const expected = ASSISTANT_ID;
    const actual = assistant?.id;
    expect(actual).toBe(expected);
  });

  it('indexes the user text as a searchable block', () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const index = new RecordingHistoryWriter();
    buildAuditWriter(fs, index).writeUser('conv-blocks', makeUserMessage('find me later'), USER_ID, QUERY_ID, TURN_ID);

    const user = index.inserted.find((m) => m.role === 'user');
    const expected = [{ seq: 0, type: 'text', text: 'find me later' }];
    const actual = user?.blocks;
    expect(actual).toEqual(expected);
  });

  it('projects one message per write', () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const index = new RecordingHistoryWriter();
    const writer = buildAuditWriter(fs, index);
    writer.writeUser('conv-both', makeUserMessage(), USER_ID, QUERY_ID, TURN_ID);
    writer.writeAssistant('conv-both', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    const expected = 2;
    const actual = index.inserted.length;
    expect(actual).toBe(expected);
  });
});

// write-model §1: a store failure must never fault the turn.
describe('AuditWriter — best-effort index projection', () => {
  it('swallows an index insert failure so the turn is not faulted', () => {
    const fs = new MemoryFileSystem({}, '/home/user');
    const writer = buildAuditWriter(fs, new ThrowingHistoryWriter());

    const act = () => writer.writeAssistant('conv-throw', makeMessage(), ASSISTANT_ID, QUERY_ID, TURN_ID);

    expect(act).not.toThrow();
  });
});
