import { Clock, Instant, ZoneId } from '@js-joda/core';
import { describe, expect, it } from 'vitest';
import type { AuditSummary } from '../src/conversations/scanAuditSummary.js';
import { AppModeState } from '../src/model/AppModeState.js';
import { ConversationListState } from '../src/model/ConversationListState.js';
import { TerminalState } from '../src/model/TerminalState.js';
import { ConversationView } from '../src/view/ConversationView.js';
import type { ViewModel } from '../src/view/View.js';

const NOW = Instant.parse('2026-07-28T14:00:00.000Z');
const CURRENT_ID = '96ad1460-4382-4b4f-bf92-97570dc8285a';
const OTHER_ID = '22392ae9-b2e7-4d33-9141-7170bad7eb9e';

const summaryOf = (overrides: Partial<AuditSummary> = {}): AuditSummary => ({
  turns: 190,
  queries: 19,
  costUsd: 16.24,
  firstUtc: '2026-07-28T10:15:14.000Z',
  lastUtc: '2026-07-28T13:37:50.000Z',
  model: 'claude-sonnet-5',
  contextTokens: 407_198,
  firstUserText: 'so after all this time, i want a read only mode',
  lastAssistantText: 'PR #490 is committed, pushed, and marked ready for review',
  ...overrides,
});

/** Strips ANSI so an assertion is about the text, not its colouring. */
function plain(rows: string[]): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI for test assertions
  return rows.join('\n').replace(/\x1b\[[^m]*m/g, '');
}

function render(listState: ConversationListState, sessionId = CURRENT_ID, cols = 120): string {
  const terminalState = new TerminalState();
  terminalState.setSize(cols, 40);
  const model = {
    conversationListState: listState,
    terminalState,
    appModeState: new AppModeState(),
    session: { id: sessionId },
    statusState: { cwdBasename: 'claude-cli' },
    clock: Clock.fixed(NOW, ZoneId.UTC),
  } as unknown as ViewModel;
  return plain(new ConversationView().render(model));
}

const listWith = (...entries: Array<{ id: string; summary?: AuditSummary }>): ConversationListState => {
  const state = new ConversationListState();
  state.setEntries(entries.map((entry) => entry.id));
  for (const entry of entries) {
    if (entry.summary !== undefined) {
      state.setSummary(entry.id, entry.summary);
    }
  }
  return state;
};

describe('ConversationView — the list', () => {
  it('names the directory the conversations belong to', () => {
    const actual = render(listWith({ id: CURRENT_ID, summary: summaryOf() }));
    expect(actual).toContain('conversations in claude-cli');
  });

  it('says so when the directory has no conversations', () => {
    const actual = render(listWith());
    expect(actual).toContain('no conversations recorded in this directory');
  });

  it('shows the full conversation id, never truncated', () => {
    const actual = render(listWith({ id: CURRENT_ID, summary: summaryOf() }));
    expect(actual).toContain(CURRENT_ID);
  });

  it('shows the opening ask', () => {
    const actual = render(listWith({ id: CURRENT_ID, summary: summaryOf() }));
    expect(actual).toContain('so after all this time, i want a read only mode');
  });

  it('shows the last reply', () => {
    const actual = render(listWith({ id: CURRENT_ID, summary: summaryOf() }));
    expect(actual).toContain('PR #490 is committed');
  });

  it('marks the conversation the process is currently on', () => {
    const actual = render(listWith({ id: CURRENT_ID, summary: summaryOf() }));
    expect(actual).toContain(`● claude-sonnet-5`.replace('claude-', ''));
  });

  it('does not mark a conversation the process is not on', () => {
    const rows = render(listWith({ id: OTHER_ID, summary: summaryOf() }), CURRENT_ID);
    expect(rows).not.toContain('●');
  });
});

describe('ConversationView — the figures', () => {
  it('shows the query count', () => {
    const actual = render(listWith({ id: CURRENT_ID, summary: summaryOf() }));
    expect(actual).toContain('19q');
  });

  it('shows the turn count', () => {
    const actual = render(listWith({ id: CURRENT_ID, summary: summaryOf() }));
    expect(actual).toContain('190t');
  });

  it('shows the cost', () => {
    const actual = render(listWith({ id: CURRENT_ID, summary: summaryOf() }));
    expect(actual).toContain('$16.2400');
  });

  it('shows the span between the first and last message', () => {
    const actual = render(listWith({ id: CURRENT_ID, summary: summaryOf() }));
    expect(actual).toContain('3h 22m');
  });

  it('shows how long ago the conversation was last active', () => {
    const actual = render(listWith({ id: CURRENT_ID, summary: summaryOf() }));
    expect(actual).toContain('22m ago');
  });

  it('shows the model without its vendor prefix', () => {
    const actual = render(listWith({ id: CURRENT_ID, summary: summaryOf() }));
    expect(actual).toContain('sonnet-5');
  });
});

describe('ConversationView — before a summary has loaded', () => {
  it('still shows the conversation id', () => {
    const actual = render(listWith({ id: CURRENT_ID }));
    expect(actual).toContain(CURRENT_ID);
  });

  it('shows a placeholder in place of the figures', () => {
    const actual = render(listWith({ id: CURRENT_ID }));
    expect(actual).toContain('·····');
  });
});

describe('ConversationView — peek', () => {
  it('shows a reading marker until the peek content lands', () => {
    const state = listWith({ id: CURRENT_ID, summary: summaryOf() });
    state.apply('toggle-peek');
    const actual = render(state);
    expect(actual).toContain('reading…');
  });

  it('shows each message opening once the peek has landed', () => {
    const state = listWith({ id: CURRENT_ID, summary: summaryOf() });
    state.apply('toggle-peek');
    state.setPeek(CURRENT_ID, { entries: [{ kind: 'user', text: 'alright, commit and push', toolCount: 0, timestampUtc: '2026-07-28T13:19:02.000Z' }], earlier: 142 });
    const actual = render(state);
    expect(actual).toContain('alright, commit and push');
  });

  it('counts the messages the peek does not reach', () => {
    const state = listWith({ id: CURRENT_ID, summary: summaryOf() });
    state.apply('toggle-peek');
    state.setPeek(CURRENT_ID, { entries: [], earlier: 142 });
    const actual = render(state);
    expect(actual).toContain('142 earlier messages');
  });

  it('shows a collapsed tool run', () => {
    const state = listWith({ id: CURRENT_ID, summary: summaryOf() });
    state.apply('toggle-peek');
    state.setPeek(CURRENT_ID, { entries: [{ kind: 'tools', text: '14 tools', toolCount: 14, timestampUtc: '2026-07-28T13:19:05.000Z' }], earlier: 0 });
    const actual = render(state);
    expect(actual).toContain('14 tools');
  });
});
