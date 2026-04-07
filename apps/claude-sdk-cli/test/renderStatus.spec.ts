import { describe, expect, it } from 'vitest';
import { renderModel, renderStatus } from '../src/renderStatus.js';
import { StatusState } from '../src/StatusState.js';

function makeState(inputTokens: number, opts: { cacheCreation?: number; cacheRead?: number; output?: number; cost?: number; contextWindow?: number } = {}): StatusState {
  const state = new StatusState();
  state.update({
    type: 'message_usage',
    inputTokens,
    cacheCreationTokens: opts.cacheCreation ?? 0,
    cacheReadTokens: opts.cacheRead ?? 0,
    outputTokens: opts.output ?? 100,
    costUsd: opts.cost ?? 0.001,
    contextWindow: opts.contextWindow ?? 200_000,
  });
  return state;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('renderStatus — empty state', () => {
  it('returns empty string when no usage recorded', () => {
    const expected = '';
    const actual = renderStatus(new StatusState(), 120);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

describe('renderStatus — content', () => {
  it('includes "in:" label', () => {
    const expected = true;
    const actual = renderStatus(makeState(1000), 120).includes('in:');
    expect(actual).toBe(expected);
  });

  it('includes "out:" label', () => {
    const expected = true;
    const actual = renderStatus(makeState(1000), 120).includes('out:');
    expect(actual).toBe(expected);
  });

  it('includes cost with $ prefix', () => {
    const expected = true;
    const actual = renderStatus(makeState(1000, { cost: 0.0042 }), 120).includes('$0.0042');
    expect(actual).toBe(expected);
  });

  it('shows cache creation with up-arrow when non-zero', () => {
    const expected = true;
    const actual = renderStatus(makeState(1000, { cacheCreation: 500 }), 120).includes('\u2191');
    expect(actual).toBe(expected);
  });

  it('omits cache creation when zero', () => {
    const expected = false;
    const actual = renderStatus(makeState(1000, { cacheCreation: 0 }), 120).includes('\u2191');
    expect(actual).toBe(expected);
  });

  it('shows cache read with down-arrow when non-zero', () => {
    const expected = true;
    const actual = renderStatus(makeState(1000, { cacheRead: 300 }), 120).includes('\u2193');
    expect(actual).toBe(expected);
  });

  it('omits cache read when zero', () => {
    const expected = false;
    const actual = renderStatus(makeState(1000, { cacheRead: 0 }), 120).includes('\u2193');
    expect(actual).toBe(expected);
  });

  it('includes context percentage when contextWindow > 0', () => {
    const expected = true;
    const actual = renderStatus(makeState(100_000, { contextWindow: 200_000 }), 120).includes('ctx:');
    expect(actual).toBe(expected);
  });

  it('omits context when contextWindow is zero', () => {
    const state = new StatusState();
    // Use a raw update that leaves contextWindow at 0
    state.update({ type: 'message_usage', inputTokens: 1000, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 100, costUsd: 0.001, contextWindow: 0 });
    const expected = false;
    const actual = renderStatus(state, 120).includes('ctx:');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// formatTokens behaviour (via rendered output)
// ---------------------------------------------------------------------------

describe('renderStatus — token formatting', () => {
  it('formats tokens below 1000 as plain number', () => {
    const expected = true;
    const actual = renderStatus(makeState(500), 120).includes('500');
    expect(actual).toBe(expected);
  });

  it('formats tokens >= 1000 with k suffix', () => {
    const expected = true;
    const actual = renderStatus(makeState(2500), 120).includes('2.5k');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// renderModel
// ---------------------------------------------------------------------------

describe('renderModel — empty state', () => {
  it('returns empty string when no model set', () => {
    const expected = '';
    const actual = renderModel(new StatusState(), 120);
    expect(actual).toBe(expected);
  });
});

describe('renderModel — model abbreviation', () => {
  it('capitalises Sonnet from new-style name (claude-sonnet-4-6)', () => {
    const state = new StatusState();
    state.setModel('claude-sonnet-4-6');
    const expected = true;
    const actual = renderModel(state, 120).includes('Sonnet');
    expect(actual).toBe(expected);
  });

  it('capitalises Sonnet from old-style name (claude-3-5-sonnet-20241022)', () => {
    const state = new StatusState();
    state.setModel('claude-3-5-sonnet-20241022');
    const expected = true;
    const actual = renderModel(state, 120).includes('Sonnet');
    expect(actual).toBe(expected);
  });

  it('capitalises Opus', () => {
    const state = new StatusState();
    state.setModel('claude-opus-4-5');
    const expected = true;
    const actual = renderModel(state, 120).includes('Opus');
    expect(actual).toBe(expected);
  });

  it('capitalises Haiku', () => {
    const state = new StatusState();
    state.setModel('claude-haiku-3-5');
    const expected = true;
    const actual = renderModel(state, 120).includes('Haiku');
    expect(actual).toBe(expected);
  });

  it('does not contain lowercase model family', () => {
    const state = new StatusState();
    state.setModel('claude-sonnet-4-6');
    const expected = false;
    const actual = renderModel(state, 120).includes('sonnet');
    expect(actual).toBe(expected);
  });
});
