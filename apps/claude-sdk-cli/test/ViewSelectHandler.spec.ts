import { Clock, Instant, ZoneId } from '@js-joda/core';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { ViewSelectHandler } from '../src/controller/ViewSelectHandler.js';
import { AppModeState } from '../src/model/AppModeState.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { HistoryViewState } from '../src/model/HistoryViewState.js';

// ViewSelectHandler injects AppModeState/HistoryViewState/ConversationState; build it through a container.
function buildViewSelectHandler(appModeState: AppModeState, historyViewState: HistoryViewState, conversation: ConversationState): ViewSelectHandler {
  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC));
  services.register(AppModeState).to(AppModeState, () => appModeState);
  services.register(HistoryViewState).to(HistoryViewState, () => historyViewState);
  services.register(ConversationState).to(ConversationState, () => conversation);
  services.register(ViewSelectHandler).to(ViewSelectHandler);
  return services.buildProvider().resolve(ViewSelectHandler);
}

function setup() {
  const appModeState = new AppModeState();
  const historyViewState = new HistoryViewState();
  const conversation = new ConversationState();
  conversation.addBlocks([
    { type: 'prompt', content: 'a' },
    { type: 'response', content: 'b' },
    { type: 'response', content: 'c' },
  ]);
  const handler = buildViewSelectHandler(appModeState, historyViewState, conversation);
  return { handler, appModeState, historyViewState };
}

describe('ViewSelectHandler', () => {
  it('selects the primary view on F1', () => {
    const { handler, appModeState } = setup();
    appModeState.setActive('history');
    handler.handleKey({ type: 'f1' });
    const expected = 'primary';
    const actual = appModeState.active;
    expect(actual).toBe(expected);
  });

  it('selects the history view on F2', () => {
    const { handler, appModeState } = setup();
    handler.handleKey({ type: 'f2' });
    const expected = 'history';
    const actual = appModeState.active;
    expect(actual).toBe(expected);
  });

  it('focuses the latest block on entry to history', () => {
    const { handler, historyViewState } = setup();
    handler.handleKey({ type: 'f2' });
    const expected = 2;
    const actual = historyViewState.focus.block;
    expect(actual).toBe(expected);
  });

  it('claims F2', () => {
    const { handler } = setup();
    const expected = true;
    const actual = handler.handleKey({ type: 'f2' });
    expect(actual).toBe(expected);
  });

  it('passes a non-bind key down', () => {
    const { handler } = setup();
    const expected = false;
    const actual = handler.handleKey({ type: 'char', value: 'a' });
    expect(actual).toBe(expected);
  });
});
