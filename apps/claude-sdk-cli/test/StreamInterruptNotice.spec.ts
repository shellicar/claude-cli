import { Clock, Instant, ZoneId } from '@js-joda/core';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { ConversationState } from '../src/model/ConversationState.js';
import { StreamInterruptNotice } from '../src/model/StreamInterruptNotice.js';
import type { ToolEntry } from '../src/model/ToolObject.js';

// StreamInterruptNotice injects ConversationState (which injects Clock); build the
// whole graph through a container so the real seal/splice behaviour is exercised.
function build(): { notice: StreamInterruptNotice; conversation: ConversationState } {
  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC));
  services.register(ConversationState).to(ConversationState);
  services.register(StreamInterruptNotice).to(StreamInterruptNotice);
  const provider = services.buildProvider();
  return { notice: provider.resolve(StreamInterruptNotice), conversation: provider.resolve(ConversationState) };
}

describe('StreamInterruptNotice', () => {
  it('seals the partial reply as a finished block', () => {
    const { notice, conversation } = build();
    conversation.transitionBlock('response');
    conversation.appendToActive('partial output');

    notice.reconnecting();

    const actual = conversation.sealedBlocks.some((b) => b.content.includes('partial output'));
    expect(actual).toBe(true);
  });

  it('splices a reconnect notice beneath the sealed reply', () => {
    const { notice, conversation } = build();
    conversation.transitionBlock('response');
    conversation.appendToActive('partial output');

    notice.reconnecting();

    const actual = conversation.activeBlock?.content.includes('Connection dropped') ?? false;
    expect(actual).toBe(true);
  });

  it('opens the reconnect notice as a notice block', () => {
    const { notice, conversation } = build();
    conversation.transitionBlock('response');
    conversation.appendToActive('partial output');

    notice.reconnecting();

    const actual = conversation.activeBlock?.type;
    expect(actual).toBe('notice');
  });

  it('seals a tools block in progress with its entries preserved', () => {
    const { notice, conversation } = build();
    conversation.transitionBlock('tools');
    const tools: ToolEntry[] = [{ name: 'ReadFile', kind: 'client', input: { path: '/foo' }, output: null, phase: 'streaming' }];
    conversation.setLastTools('tools', 'ReadFile', tools);

    notice.reconnecting();

    const sealed = conversation.sealedBlocks.find((b) => b.type === 'tools');
    const actual = sealed?.tools?.[0]?.name;
    expect(actual).toBe('ReadFile');
  });
});
