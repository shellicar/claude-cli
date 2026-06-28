import { Clock } from '@js-joda/core';
import { IClockProvider } from '@shellicar/claude-core/providers/IClockProvider';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { HistoryNavHandler } from '../src/controller/HistoryNavHandler.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { HistoryViewState } from '../src/model/HistoryViewState.js';
import { TerminalState } from '../src/model/TerminalState.js';

// HistoryNavHandler injects HistoryViewState/ConversationState/TerminalState; build it through a container.
function buildHistoryNavHandler(state: HistoryViewState, conversation: ConversationState, terminal: TerminalState): HistoryNavHandler {
  const services = createServiceCollection();
  services.register(IClockProvider).to(IClockProvider, () => ({ clock: Clock.systemUTC() }));
  services.register(HistoryViewState).to(HistoryViewState, () => state);
  services.register(ConversationState).to(ConversationState, () => conversation);
  services.register(TerminalState).to(TerminalState, () => terminal);
  services.register(HistoryNavHandler).to(HistoryNavHandler);
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
