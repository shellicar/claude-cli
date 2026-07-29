import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { ViewSelectHandler } from '../src/controller/ViewSelectHandler.js';
import { IConversationListLoader } from '../src/conversations/ConversationListLoader.js';
import { AppModeState, IAppModeState } from '../src/model/AppModeState.js';
import { ConversationListState, IConversationListState } from '../src/model/ConversationListState.js';
import { ConversationState, IConversationState } from '../src/model/ConversationState.js';
import { HistoryViewState, IHistoryViewState } from '../src/model/HistoryViewState.js';

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

// ViewSelectHandler injects AppModeState/HistoryViewState/ConversationState; build it through a
// container. ConversationState's own declared dependencies (Clock, ILogger) still need
// registrations for the container's dependency plan, even though this factory supplies a
// pre-built instance.
function buildViewSelectHandler(appModeState: AppModeState, historyViewState: HistoryViewState, conversation: ConversationState, listState: ConversationListState, onRefresh: () => void): ViewSelectHandler {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(Clock)
    .using(() => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC))
    .asSelf();
  services
    .register(ILogger)
    .using(() => new NoopLogger())
    .asSelf();
  services
    .register(AppModeState)
    .using(() => appModeState)
    .asSelf()
    .as(IAppModeState);
  services
    .register(HistoryViewState)
    .using(() => historyViewState)
    .asSelf()
    .as(IHistoryViewState);
  services
    .register(ConversationState)
    .using(() => conversation)
    .asSelf()
    .as(IConversationState);
  services
    .register(ConversationListState)
    .using(() => listState)
    .asSelf()
    .as(IConversationListState);
  services
    .register(IConversationListLoader)
    .using(() => ({ refresh: onRefresh }))
    .asSelf();
  services.register(ViewSelectHandler).asSelf();
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
  const listState = new ConversationListState();
  const refreshes = { count: 0 };
  const handler = buildViewSelectHandler(appModeState, historyViewState, conversation, listState, () => {
    refreshes.count += 1;
  });
  return { handler, appModeState, historyViewState, listState, refreshes };
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

  it('selects the conversation view on F3', () => {
    const { handler, appModeState } = setup();
    handler.handleKey({ type: 'f3' });
    const expected = 'conversations';
    const actual = appModeState.active;
    expect(actual).toBe(expected);
  });

  it('rebuilds the conversation list on entry, so a conversation created since is listed', () => {
    const { handler, refreshes } = setup();
    handler.handleKey({ type: 'f3' });
    const expected = 1;
    const actual = refreshes.count;
    expect(actual).toBe(expected);
  });

  it('claims F3', () => {
    const { handler } = setup();
    const expected = true;
    const actual = handler.handleKey({ type: 'f3' });
    expect(actual).toBe(expected);
  });
});
