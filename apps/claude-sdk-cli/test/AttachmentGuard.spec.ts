import { Clock, Instant, ZoneOffset } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { AgentPresence, IAgentPresence } from '../src/agent/AgentPresence.js';
import { AttachmentGuard, IAttachmentGuard } from '../src/agent/AttachmentGuard.js';
import { IBus } from '../src/bus/IBus.js';
import { IConvServe } from '../src/conv/ConvServe.js';
import { logger } from '../src/logger.js';
import { IConversationState } from '../src/model/ConversationState.js';
import { CapturingBus } from './CapturingBus.js';

const CONV = 'conv-abc';
const clock = Clock.fixed(Instant.parse('2026-07-07T11:00:00Z'), ZoneOffset.ofHours(10));
const encode = (body: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(body));

const fakeConfigLoader = {
  get config() {
    return { nats: { world: 'mac', pulseIntervalS: 30 } };
  },
} as unknown as ConfigLoader<never>;

function build() {
  const bus = new CapturingBus();
  const notices: string[] = [];
  let unbound = 0;
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IBus)
    .using(() => bus)
    .asSelf();
  services
    .register(Clock)
    .using(() => clock)
    .asSelf();
  services
    .register(ConfigLoader)
    .using(() => fakeConfigLoader)
    .asSelf();
  services.register(AgentPresence).as(IAgentPresence);
  services
    .register(IConvServe)
    .using(
      () =>
        ({
          bind: () => {},
          unbind: () => {
            unbound += 1;
          },
        }) as IConvServe,
    )
    .asSelf();
  services
    .register(IConversationState)
    .using(() => ({ completeActive: () => {}, spliceNotice: (text: string) => notices.push(text) }) as unknown as IConversationState)
    .asSelf();
  services
    .register(ILogger)
    .using(() => logger)
    .asSelf();
  services.register(AttachmentGuard).as(IAttachmentGuard);
  const provider = services.buildProvider();
  const guard = provider.resolve(IAttachmentGuard);
  const presence = provider.resolve(IAgentPresence);
  return { bus, guard, presence, notices, unboundCount: () => unbound };
}

function attachAndWatch() {
  const built = build();
  built.guard.watch(CONV);
  built.presence.attach(CONV, '~/repos/tower', null);
  return built;
}

describe('AttachmentGuard', () => {
  it('ignores its own claim echoed back', () => {
    const { bus, presence, notices } = attachAndWatch();
    bus.deliver(`conv.v2.${CONV}.attachment.attached`, encode({ ts: '2026-07-07T21:00:00+10:00', instanceId: presence.instanceId, world: 'mac' }));
    const expected = 0;
    const actual = notices.length;
    expect(actual).toBe(expected);
  });

  it('publishes detached as the observable act of standing down when superseded', () => {
    const { bus, presence } = attachAndWatch();
    bus.deliver(`conv.v2.${CONV}.attachment.attached`, encode({ ts: '2026-07-07T21:00:00+10:00', instanceId: 'inst-other', world: 'vm' }));
    const expected = true;
    const actual = bus.published.some((c) => c.subject === `conv.v2.${CONV}.attachment.detached` && c.body.instanceId === presence.instanceId);
    expect(actual).toBe(expected);
  });

  it('closes the claim so a displaced instance stops committing', () => {
    const { bus, presence } = attachAndWatch();
    bus.deliver(`conv.v2.${CONV}.attachment.attached`, encode({ ts: '2026-07-07T21:00:00+10:00', instanceId: 'inst-other', world: 'vm' }));
    const expected = false;
    const actual = presence.hasClaim(CONV);
    expect(actual).toBe(expected);
  });

  it('drops the wire serve binding when superseded', () => {
    const { bus, unboundCount } = attachAndWatch();
    bus.deliver(`conv.v2.${CONV}.attachment.attached`, encode({ ts: '2026-07-07T21:00:00+10:00', instanceId: 'inst-other', world: 'vm' }));
    const expected = 1;
    const actual = unboundCount();
    expect(actual).toBe(expected);
  });

  it('surfaces the displacement to the user', () => {
    const { bus, notices } = attachAndWatch();
    bus.deliver(`conv.v2.${CONV}.attachment.attached`, encode({ ts: '2026-07-07T21:00:00+10:00', instanceId: 'inst-other', world: 'vm' }));
    const expected = true;
    const actual = notices.some((n) => n.includes('served by another instance'));
    expect(actual).toBe(expected);
  });

  it('treats a same-instanceId claim from another world as displacement', () => {
    const { bus, presence } = attachAndWatch();
    bus.deliver(`conv.v2.${CONV}.attachment.attached`, encode({ ts: '2026-07-07T21:00:00+10:00', instanceId: presence.instanceId, world: 'vm' }));
    const expected = false;
    const actual = presence.hasClaim(CONV);
    expect(actual).toBe(expected);
  });
});
