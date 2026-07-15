import { Clock, Instant, ZoneId } from '@js-joda/core';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { AppModeState } from '../src/model/AppModeState.js';
import { CommandModeState } from '../src/model/CommandModeState.js';
import type { ConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { EditorState } from '../src/model/EditorState.js';
import { HistoryViewState } from '../src/model/HistoryViewState.js';
import { ITurnClock } from '../src/model/ITurnClock.js';
import { PrimaryViewState } from '../src/model/PrimaryViewState.js';
import { ScrollState } from '../src/model/ScrollState.js';
import { StatusState } from '../src/model/StatusState.js';
import { TerminalState } from '../src/model/TerminalState.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { TurnClock } from '../src/model/TurnClock.js';
import { PrimaryView } from '../src/view/PrimaryView.js';
import type { ViewModel } from '../src/view/View.js';

function makeConversationState(clock: Clock): ConversationState {
  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => clock);
  services.register(ConversationState).to(ConversationState);
  return services.buildProvider().resolve(ConversationState);
}

function makeTurnClock(): ITurnClock {
  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => Clock.systemDefaultZone());
  services.register(ITurnClock).to(TurnClock);
  return services.buildProvider().resolve(ITurnClock);
}

function makeModel(): ViewModel {
  const terminalState = new TerminalState();
  terminalState.setSize(80, 24);
  return {
    conversationState: new ConversationState(),
    editorState: new EditorState(),
    toolApprovalState: new ToolApprovalState(),
    commandModeState: new CommandModeState(),
    statusState: new StatusState('test'),
    turnClock: makeTurnClock(),
    terminalState,
    primaryViewState: new PrimaryViewState(),
    scrollState: new ScrollState(),
    historyViewState: new HistoryViewState(),
    appModeState: new AppModeState(),
    session: { id: 'sess-123', turnCount: 0 } as unknown as ConversationSession,
    configLoader: { config: { markdown: { enabled: true, streaming: true } } } as unknown as ViewModel['configLoader'],
  };
}

describe('PrimaryView — editor region', () => {
  it('includes the prompt divider in editor phase', () => {
    const model = makeModel();
    const rows = new PrimaryView().render(model);
    const expected = true;
    const actual = rows.join('\n').includes('prompt');
    expect(actual).toBe(expected);
  });

  it('shows the prompt start time once the prompt is entered', () => {
    const clock = Clock.fixed(Instant.parse('2026-07-07T13:38:00Z'), ZoneId.systemDefault());
    const model = makeModel();
    model.conversationState = makeConversationState(clock);
    model.conversationState.markPromptStart();

    const rows = new PrimaryView().render(model);
    const promptRow = rows.find((row) => row.includes('prompt'));
    const expected = true;
    const actual = /\d{2}:\d{2}:\d{2}/.test(promptRow ?? '');

    expect(actual).toBe(expected);
  });

  it('omits the prompt divider in streaming phase', () => {
    const model = makeModel();
    model.primaryViewState.setPhase('streaming');
    const rows = new PrimaryView().render(model);
    const expected = false;
    const actual = rows.join('\n').includes('prompt');
    expect(actual).toBe(expected);
  });
});

describe('PrimaryView — status', () => {
  it('threads the session id into the model line', () => {
    const model = makeModel();
    model.statusState.setModel('claude-x');
    model.statusState.setShowConversationId(true);
    const rows = new PrimaryView().render(model);
    const expected = true;
    const actual = rows.join('\n').includes('sess-123');
    expect(actual).toBe(expected);
  });
});

describe('PrimaryView — scroll', () => {
  function tallStreamingModel(): ViewModel {
    const model = makeModel();
    model.primaryViewState.setPhase('streaming');
    model.conversationState.addBlocks(Array.from({ length: 40 }, (_, i) => ({ type: 'response' as const, content: `line ${i}` })));
    return model;
  }

  it('pins to the bottom with no indicator by default', () => {
    const model = tallStreamingModel();
    const rows = new PrimaryView().render(model);
    const expected = false;
    const actual = rows.join('\n').includes('scroll down to resume');
    expect(actual).toBe(expected);
  });

  it('shows the indicator once scrolled back', () => {
    const model = tallStreamingModel();
    const view = new PrimaryView();
    view.render(model); // measure geometry
    model.scrollState.lineUp();
    const rows = view.render(model);
    const expected = true;
    const actual = rows.join('\n').includes('scroll down to resume');
    expect(actual).toBe(expected);
  });

  it('keeps the editor region below the transcript when scrolled', () => {
    const model = makeModel();
    model.conversationState.addBlocks(Array.from({ length: 40 }, (_, i) => ({ type: 'response' as const, content: `line ${i}` })));
    const view = new PrimaryView();
    view.render(model);
    model.scrollState.lineUp();
    const rows = view.render(model);
    const indicatorRow = rows.findIndex((row) => row.includes('scroll down to resume'));
    const promptRow = rows.findIndex((row) => row.includes('prompt'));
    const expected = true;
    const actual = indicatorRow >= 0 && promptRow > indicatorRow;
    expect(actual).toBe(expected);
  });
});
