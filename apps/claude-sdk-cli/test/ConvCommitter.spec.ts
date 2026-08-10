import { Clock, Instant, ZoneOffset } from '@js-joda/core';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import { Conversation, IConversation } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { AuditWriter } from '../src/AuditWriter.js';
import { IBus } from '../src/bus/IBus.js';
import { ConvCommitter, IMessageCommitter, IQueryCloser } from '../src/conv/ConvCommitter.js';
import { CapturingBus } from './CapturingBus.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const AUDIT = '/home/user/.claude/audit/conv-1.jsonl';

/** The index is a projection nothing here asserts on. */
class DiscardingHistoryWriter extends IHistoryWriter {
  public insert(): void {}
}

function build(): { committer: ConvCommitter; conversation: Conversation; bus: CapturingBus; fs: MemoryFileSystem } {
  const bus = new CapturingBus();
  const conversation = new Conversation();
  const fs = new MemoryFileSystem({}, '/home/user');
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(Conversation)
    .using(() => conversation)
    .asSelf()
    .as(IConversation);
  services
    .register(CapturingBus)
    .using(() => bus)
    .as(IBus);
  services
    .register(Clock)
    .using(() => Clock.fixed(Instant.parse('2026-07-26T08:00:00Z'), ZoneOffset.UTC))
    .asSelf();
  services
    .register(IFileSystem)
    .using(() => fs)
    .asSelf();
  services
    .register(IHistoryWriter)
    .using(() => new DiscardingHistoryWriter())
    .asSelf();
  services.register(AuditWriter).asSelf();
  services.register(ConvCommitter).asSelf().as(IMessageCommitter);
  services
    .register(IQueryCloser)
    .using([ConvCommitter], (committer) => committer)
    .asSelf();
  return { committer: services.buildProvider().resolve(ConvCommitter), conversation, bus, fs };
}

const messagesOn = (bus: CapturingBus): number => bus.published.filter((c) => c.subject === 'conv.v2.conv-1.changes.message').length;

async function auditIds(fs: MemoryFileSystem): Promise<string[]> {
  // The append is fire-and-forget inside the writer, so let it land before reading.
  await new Promise((r) => setTimeout(r, 10));
  return (await fs.readFile(AUDIT))
    .trimEnd()
    .split('\n')
    .map((line) => (JSON.parse(line) as { id: string }).id);
}

const idsOn = (bus: CapturingBus): string[] => bus.published.filter((c) => c.subject === 'conv.v2.conv-1.changes.message').map((c) => (c.body as { id: string }).id);

describe('ConvCommitter — a merged row is one message', () => {
  // Consecutive user messages merge into one row because the API requires strict role alternation.
  // The row grows, so what the conversation holds changes, and the wire has to be told.
  it('announces the fuller content when a row grows', () => {
    const { committer, conversation, bus } = build();
    conversation.push({ role: 'user', content: [{ type: 'text', text: 'first' }] });
    committer.announceTip('conv-1', 'q1', 't1');
    conversation.push({ role: 'user', content: [{ type: 'text', text: 'second' }] });
    committer.announceTip('conv-1', 'q2', 't2');

    const expected = ['first', 'second'];
    const actual = ((bus.published.filter((c) => c.subject === 'conv.v2.conv-1.changes.message').at(-1)?.body as { content: { text: string }[] }).content ?? []).map((b) => b.text);
    expect(actual).toEqual(expected);
  });

  // The row grew; it did not become a second message. The state of a message is its latest
  // announcement, last-write-wins per id, so the fuller content has to arrive under the same id.
  it('announces a grown row under the id it already had', () => {
    const { committer, conversation, bus } = build();
    conversation.push({ role: 'user', content: [{ type: 'text', text: 'first' }] });
    committer.announceTip('conv-1', 'q1', 't1');
    conversation.push({ role: 'user', content: [{ type: 'text', text: 'second' }] });
    committer.announceTip('conv-1', 'q2', 't2');

    const expected = 1;
    const actual = new Set(idsOn(bus)).size;
    expect(actual).toBe(expected);
  });

  it('records every send of a merged row under one id', async () => {
    const { committer, conversation, fs } = build();
    conversation.push({ role: 'user', content: [{ type: 'text', text: 'first' }] });
    committer.recordSent('conv-1', conversation.items[0]?.msg as never, 'q1', 't1');
    conversation.push({ role: 'user', content: [{ type: 'text', text: 'second' }] });
    committer.recordSent('conv-1', conversation.items[0]?.msg as never, 'q2', 't2');

    const ids = await auditIds(fs);
    const expected = 1;
    const actual = new Set(ids).size;
    expect(actual).toBe(expected);
  });

  it('announces a genuinely new row as its own message', () => {
    const { committer, conversation, bus } = build();
    conversation.push({ role: 'user', content: [{ type: 'text', text: 'ask' }] });
    committer.announceTip('conv-1', 'q1', 't1');
    conversation.push({ role: 'assistant', content: [{ type: 'text', text: 'reply' }] });
    committer.announceAssistant('conv-1', 'a1', 'q1', 't1');

    const expected = 2;
    const actual = messagesOn(bus);
    expect(actual).toBe(expected);
  });
});

describe('ConvCommitter — query closure', () => {
  // A closure is a committal fact: a query closes once. On a cancel, the router closes it
  // `cancelled` and the turn's pending close still fires `aborted` for the same queryId — two
  // contradictory closure facts on the wire.
  it('publishes at most one closure per query', () => {
    const { committer, bus } = build();
    committer.closeQuery('conv-1', 'query-1', 'cancelled');
    committer.closeQuery('conv-1', 'query-1', 'aborted');
    const expected = 1;
    const actual = bus.published.filter((c) => c.subject === 'conv.v2.conv-1.changes.query').length;
    expect(actual).toBe(expected);
  });
});
