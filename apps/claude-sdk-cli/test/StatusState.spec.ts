import { MemoryFileSystem } from '@shellicar/claude-sdk-tools/fs';
import { describe, expect, it } from 'vitest';
import { StatusState } from '../src/model/StatusState.js';

const testFs = new MemoryFileSystem({}, '/home/user', '/repos/my-project');

function makeState(): StatusState {
  return new StatusState(testFs);
}

function makeUsage(inputTokens: number, opts: { cacheCreation?: number; cacheRead?: number; output?: number; cost?: number; contextWindow?: number } = {}): Parameters<StatusState['update']>[0] {
  return {
    type: 'message_usage',
    inputTokens,
    cacheCreationTokens: opts.cacheCreation ?? 0,
    cacheReadTokens: opts.cacheRead ?? 0,
    outputTokens: opts.output ?? 100,
    costUsd: opts.cost ?? 0.001,
    contextWindow: opts.contextWindow ?? 200_000,
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('StatusState — initial state', () => {
  it('totalInputTokens starts at zero', () => {
    const expected = 0;
    const actual = makeState().totalInputTokens;
    expect(actual).toBe(expected);
  });

  it('totalCostUsd starts at zero', () => {
    const expected = 0;
    const actual = makeState().totalCostUsd;
    expect(actual).toBe(expected);
  });

  it('contextWindow starts at zero', () => {
    const expected = 0;
    const actual = makeState().contextWindow;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// update() — accumulation
// ---------------------------------------------------------------------------

describe('StatusState — update accumulates tokens', () => {
  it('accumulates inputTokens across updates', () => {
    const state = makeState();
    state.update(makeUsage(1000));
    state.update(makeUsage(500));
    const expected = 1500;
    const actual = state.totalInputTokens;
    expect(actual).toBe(expected);
  });

  it('accumulates cacheCreationTokens', () => {
    const state = makeState();
    state.update(makeUsage(0, { cacheCreation: 200 }));
    state.update(makeUsage(0, { cacheCreation: 300 }));
    const expected = 500;
    const actual = state.totalCacheCreationTokens;
    expect(actual).toBe(expected);
  });

  it('accumulates cacheReadTokens', () => {
    const state = makeState();
    state.update(makeUsage(0, { cacheRead: 400 }));
    state.update(makeUsage(0, { cacheRead: 100 }));
    const expected = 500;
    const actual = state.totalCacheReadTokens;
    expect(actual).toBe(expected);
  });

  it('accumulates outputTokens', () => {
    const state = makeState();
    state.update(makeUsage(0, { output: 300 }));
    state.update(makeUsage(0, { output: 200 }));
    const expected = 500;
    const actual = state.totalOutputTokens;
    expect(actual).toBe(expected);
  });

  it('accumulates costUsd', () => {
    const state = makeState();
    state.update(makeUsage(0, { cost: 0.001 }));
    state.update(makeUsage(0, { cost: 0.002 }));
    const expected = 0.003;
    const actual = Number(state.totalCostUsd.toFixed(3));
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// update() — last-value fields (not accumulated)
// ---------------------------------------------------------------------------

describe('StatusState — update overwrites lastContextUsed and contextWindow', () => {
  it('lastContextUsed is sum of input+cacheCreate+cacheRead from last update', () => {
    const state = makeState();
    state.update(makeUsage(1000, { cacheCreation: 200, cacheRead: 300 }));
    const expected = 1500;
    const actual = state.lastContextUsed;
    expect(actual).toBe(expected);
  });

  it('lastContextUsed is overwritten (not accumulated) on second update', () => {
    const state = makeState();
    state.update(makeUsage(1000));
    state.update(makeUsage(500));
    const expected = 500;
    const actual = state.lastContextUsed;
    expect(actual).toBe(expected);
  });

  it('contextWindow is overwritten on second update', () => {
    const state = makeState();
    state.update(makeUsage(0, { contextWindow: 100_000 }));
    state.update(makeUsage(0, { contextWindow: 200_000 }));
    const expected = 200_000;
    const actual = state.contextWindow;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// setModel / model
// ---------------------------------------------------------------------------

describe('StatusState — model', () => {
  it('model starts as empty string', () => {
    const expected = '';
    const actual = makeState().model;
    expect(actual).toBe(expected);
  });

  it('setModel stores the model name', () => {
    const state = makeState();
    state.setModel('claude-sonnet-4-6');
    const expected = 'claude-sonnet-4-6';
    const actual = state.model;
    expect(actual).toBe(expected);
  });

  it('setModel overwrites the previous value', () => {
    const state = makeState();
    state.setModel('claude-sonnet-4-6');
    state.setModel('claude-opus-4-5');
    const expected = 'claude-opus-4-5';
    const actual = state.model;
    expect(actual).toBe(expected);
  });
});
