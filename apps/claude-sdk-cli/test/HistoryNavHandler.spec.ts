import { Clock, Instant, ZoneId } from '@js-joda/core';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { HistoryNavHandler } from '../src/controller/HistoryNavHandler.js';
import { ConversationState, IConversationState } from '../src/model/ConversationState.js';
import { HistoryViewState, IHistoryViewState } from '../src/model/HistoryViewState.js';
import { ITerminalState, TerminalState } from '../src/model/TerminalState.js';

// HistoryNavHandler injects HistoryViewState/ConversationState/TerminalState; build it through a container.
function buildHistoryNavHandler(state: HistoryViewState, conversation: ConversationState, terminal: TerminalState): HistoryNavHandler {
  const services = createServiceCollection();
  services
    .register(Clock)
    .using(() => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC))
    .asSelf();
  services
    .register(HistoryViewState)
    .using(() => state)
    .asSelf()
    .as(IHistoryViewState);
  services
    .register(ConversationState)
    .using(() => conversation)
    .asSelf()
    .as(IConversationState);
  services
    .register(TerminalState)
    .using(() => terminal)
    .asSelf()
    .as(ITerminalState);
  services.register(HistoryNavHandler).asSelf();
  return services.buildProvider().resolve(HistoryNavHandler);
}

function setup() {
  const conversation = new ConversationState();
  conversation.addBlocks([
    { type: 'prompt', content: 'ask' },
    {
      type: 'tools',
      content: 'tool lines',
      tools: [{ name: 'ReadFile', kind: 'client', input: { path: 'a.ts' }, output: 'contents', phase: 'done' }],
    },
  ]);
  const terminal = new TerminalState();
  terminal.setSize(80, 24);
  const state = new HistoryViewState();
  const handler = buildHistoryNavHandler(state, conversation, terminal);
  return { handler, state };
}

describe('HistoryNavHandler', () => {
  it('claims a mapped key', () => {
    const { handler } = setup();
    const expected = true;
    const actual = handler.handleKey({ type: 'down' });
    expect(actual).toBe(expected);
  });

  it('mutates the navigation state for a mapped key', () => {
    const { handler, state } = setup();
    handler.handleKey({ type: 'down' });
    const expected = 1;
    const actual = state.focus.block;
    expect(actual).toBe(expected);
  });

  it('passes an unmapped key down', () => {
    const { handler } = setup();
    const expected = false;
    const actual = handler.handleKey({ type: 'char', value: 'a' });
    expect(actual).toBe(expected);
  });
});
