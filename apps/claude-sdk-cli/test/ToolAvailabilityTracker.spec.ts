import type { Anthropic } from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ToolAvailabilityTracker } from '../src/setup/ToolAvailabilityTracker.js';

type Message = Anthropic.Beta.Messages.BetaMessageParam;

function reminderMessage(text: string): Message {
  return { role: 'user', content: [{ type: 'text', text: `<system-reminder>\n${text}\n</system-reminder>\n` }] };
}

describe('ToolAvailabilityTracker — fresh conversation', () => {
  it('announces every enabled tool as newly enabled when history holds no prior reminder', () => {
    const tracker = new ToolAvailabilityTracker();
    const actual = tracker.scanForDelta([], new Set(['A', 'B']));
    expect(actual).toBe('Enabled tools: A, B.');
  });

  it('announces nothing on the next call when nothing changed', () => {
    const tracker = new ToolAvailabilityTracker();
    tracker.scanForDelta([], new Set(['A', 'B']));
    const actual = tracker.scanForDelta([], new Set(['A', 'B']));
    expect(actual).toBe(null);
  });
});

describe('ToolAvailabilityTracker — live changes', () => {
  it('announces only the newly enabled tool when one is added', () => {
    const tracker = new ToolAvailabilityTracker();
    tracker.scanForDelta([], new Set(['A', 'B']));
    const actual = tracker.scanForDelta([], new Set(['A', 'B', 'C']));
    expect(actual).toBe('Enabled tools: C.');
  });

  it('announces only the newly disabled tool when one is removed', () => {
    const tracker = new ToolAvailabilityTracker();
    tracker.scanForDelta([], new Set(['A', 'B']));
    const actual = tracker.scanForDelta([], new Set(['A']));
    expect(actual).toBe('Disabled tools: B.');
  });

  it('announces both halves together when tools are simultaneously added and removed', () => {
    const tracker = new ToolAvailabilityTracker();
    tracker.scanForDelta([], new Set(['A', 'B']));
    const actual = tracker.scanForDelta([], new Set(['A', 'C']));
    expect(actual).toBe('Enabled tools: C. Disabled tools: B.');
  });
});

describe('ToolAvailabilityTracker — seeding from history', () => {
  it('reconstructs the baseline by replaying every reminder in order', () => {
    const history: Message[] = [reminderMessage('Enabled tools: A, B.'), { role: 'assistant', content: 'ok' }, reminderMessage('Enabled tools: C. Disabled tools: B.')];
    const tracker = new ToolAvailabilityTracker();
    // Reconstructed baseline is {A, C}; live set adds nothing and removes nothing.
    const actual = tracker.scanForDelta(history, new Set(['A', 'C']));
    expect(actual).toBe(null);
  });

  it('diffs the live set against the reconstructed baseline, not the full history', () => {
    const history: Message[] = [reminderMessage('Enabled tools: A, B.')];
    const tracker = new ToolAvailabilityTracker();
    const actual = tracker.scanForDelta(history, new Set(['A', 'C']));
    expect(actual).toBe('Enabled tools: C. Disabled tools: B.');
  });

  it('ignores unrelated text blocks that are not one of its own reminders', () => {
    const history: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'Enabled tools: X. (typed by a person, not wrapped in a system-reminder)' }] }];
    const tracker = new ToolAvailabilityTracker();
    const actual = tracker.scanForDelta(history, new Set(['A']));
    expect(actual).toBe('Enabled tools: A.');
  });
});

describe('ToolAvailabilityTracker — cancel and resend', () => {
  it('does not re-announce the same delta on a resend after a cancel, when nothing changed in between', () => {
    const tracker = new ToolAvailabilityTracker();
    const first = tracker.scanForDelta([], new Set(['A', 'B']));
    // The cancelled attempt's message still landed (see class doc): the second call is the resend,
    // computed against the same unmoved baseline.
    const second = tracker.scanForDelta([], new Set(['A', 'B']));
    expect(first).toBe('Enabled tools: A, B.');
    expect(second).toBe(null);
  });

  it('reflects the mode at the time of the eventual send, not at an earlier cancelled attempt', () => {
    const tracker = new ToolAvailabilityTracker();
    tracker.scanForDelta([], new Set(['A', 'B'])); // cancelled attempt, still landed
    const actual = tracker.scanForDelta([], new Set(['A'])); // resend, mode changed in between
    expect(actual).toBe('Disabled tools: B.');
  });
});
