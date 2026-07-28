import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { Conversation, IConversation } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { IBus } from '../src/bus/IBus.js';
import { ConvServe, IConvServe } from '../src/conv/ConvServe.js';
import { ConvServicer, IConvServicer } from '../src/conv/ConvServicer.js';
import { IWireAttachmentLedger, WireAttachmentLedger } from '../src/conv/WireAttachmentLedger.js';
import { IWireSayInbox, WireSayInbox } from '../src/conv/WireSayInbox.js';
import { logger } from '../src/logger.js';
import { ConsumerChannel } from '../src/setup/ConsumerChannel.js';
import { CapturingBus } from './CapturingBus.js';

// ---------------------------------------------------------------------------
// ConvServe owns the addressable serve binding. On /new the conversation
// switches, so the subject must move with it: bind disposes the previous serve
// and serves the new id. The CapturingBus records serves by subject and its
// dispose fn deletes the entry, so a re-point is observable as a subject swap.
// ---------------------------------------------------------------------------

function buildConvServe(bus: CapturingBus): IConvServe {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IBus)
    .using(() => bus)
    .asSelf();
  services.register(Conversation).asSelf().as(IConversation);
  services.register(WireSayInbox).as(IWireSayInbox);
  services.register(WireAttachmentLedger).as(IWireAttachmentLedger);
  services.register(ConsumerChannel).asSelf();
  services
    .register(ILogger)
    .using(() => logger)
    .asSelf();
  services.register(ConvServicer).as(IConvServicer);
  services.register(ConvServe).as(IConvServe);
  return services.buildProvider().resolve(IConvServe);
}

describe('ConvServe', () => {
  it('serves the conversation requests subject on bind', () => {
    const bus = new CapturingBus();
    const convServe = buildConvServe(bus);
    convServe.bind('conv-a');
    const expected = true;
    const actual = bus.serves.has('conv.v2.conv-a.requests.*');
    expect(actual).toBe(expected);
  });

  it('serves the new conversation subject after a re-bind', () => {
    const bus = new CapturingBus();
    const convServe = buildConvServe(bus);
    convServe.bind('conv-a');
    convServe.bind('conv-b');
    const expected = true;
    const actual = bus.serves.has('conv.v2.conv-b.requests.*');
    expect(actual).toBe(expected);
  });

  it('drops the old conversation subject after a re-bind', () => {
    const bus = new CapturingBus();
    const convServe = buildConvServe(bus);
    convServe.bind('conv-a');
    convServe.bind('conv-b');
    const expected = false;
    const actual = bus.serves.has('conv.v2.conv-a.requests.*');
    expect(actual).toBe(expected);
  });
});
