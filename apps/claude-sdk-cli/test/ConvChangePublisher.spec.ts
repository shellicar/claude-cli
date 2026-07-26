import { Clock, Instant, ZoneOffset } from '@js-joda/core';
import { IConversation } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { IBus } from '../src/bus/IBus.js';
import { ConvChangePublisher, IConvChangePublisher } from '../src/conv/ConvChangePublisher.js';
import { CapturingBus } from './CapturingBus.js';

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
