import { Clock, Instant, ZoneOffset } from '@js-joda/core';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import { IConversation } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { AuditWriter } from '../src/AuditWriter.js';
import { IBus } from '../src/bus/IBus.js';
import { ConvChangePublisher, IConvChangePublisher } from '../src/conv/ConvChangePublisher.js';
import { CapturingBus } from './CapturingBus.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

/** The index is a projection nothing here asserts on. */
class DiscardingHistoryWriter extends IHistoryWriter {
  public insert(): void {}
}

function buildPublisher(): { publisher: IConvChangePublisher; bus: CapturingBus } {
  const bus = new CapturingBus();
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IConversation)
    .using(() => ({ items: [] }) as unknown as IConversation)
    .asSelf();
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
    .using(() => new MemoryFileSystem({}, '/home/user'))
    .asSelf();
  services
    .register(IHistoryWriter)
    .using(() => new DiscardingHistoryWriter())
    .asSelf();
  services.register(AuditWriter).asSelf();
  services.register(ConvChangePublisher).as(IConvChangePublisher);
  const publisher = services.buildProvider().resolve(IConvChangePublisher);
  return { publisher, bus };
}

describe('ConvChangePublisher', () => {
  // A closure is a committal fact: a query closes once. On a cancel, the router closes it
  // `cancelled` and the turn's pending close still fires `aborted` for the same queryId — two
  // contradictory closure facts on the wire.
  it('publishes at most one closure per query', () => {
    const { publisher, bus } = buildPublisher();
    publisher.closeQuery('conv-1', 'query-1', 'cancelled');
    publisher.closeQuery('conv-1', 'query-1', 'aborted');
    const expected = 1;
    const actual = bus.published.filter((c) => c.subject === 'conv.v2.conv-1.changes.query').length;
    expect(actual).toBe(expected);
  });
});
