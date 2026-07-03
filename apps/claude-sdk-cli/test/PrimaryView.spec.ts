import { Clock } from '@js-joda/core';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { AppModeState } from '../src/model/AppModeState.js';
import { CommandModeState } from '../src/model/CommandModeState.js';
import type { ConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { EditorState } from '../src/model/EditorState.js';
import { HistoryViewState } from '../src/model/HistoryViewState.js';
import { PrimaryViewState } from '../src/model/PrimaryViewState.js';
import { ITurnClock } from '../src/model/ITurnClock.js';
import { StatusState } from '../src/model/StatusState.js';
import { TerminalState } from '../src/model/TerminalState.js';
import { TurnClock } from '../src/model/TurnClock.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { PrimaryView } from '../src/view/PrimaryView.js';
import type { ViewModel } from '../src/view/View.js';

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
