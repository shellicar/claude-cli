import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { Flasher } from '../src/view/Flasher.js';

describe('Flasher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not tick without pending approvals', () => {
    const state = new ToolApprovalState();
    const flasher = new Flasher(state);
    vi.advanceTimersByTime(1000);
    const actual = state.flashPhase;
    flasher[Symbol.dispose]();
    const expected = false;
    expect(actual).toBe(expected);
  });

  it('toggles the flash phase while an approval is pending', () => {
    const state = new ToolApprovalState();
    const flasher = new Flasher(state);
    void state.requestApproval();
    vi.advanceTimersByTime(500);
    const actual = state.flashPhase;
    flasher[Symbol.dispose]();
    const expected = true;
    expect(actual).toBe(expected);
  });

  it('stops ticking once approvals are cleared', () => {
    const state = new ToolApprovalState();
    const flasher = new Flasher(state);
    void state.requestApproval();
    vi.advanceTimersByTime(500);
    state.resolveNextApproval(true);
    const before = state.flashPhase;
    vi.advanceTimersByTime(1000);
    const actual = state.flashPhase;
    flasher[Symbol.dispose]();
    expect(actual).toBe(before);
  });

  it('stops ticking after dispose', () => {
    const state = new ToolApprovalState();
    const flasher = new Flasher(state);
    void state.requestApproval();
    vi.advanceTimersByTime(500);
    flasher[Symbol.dispose]();
    const before = state.flashPhase;
    vi.advanceTimersByTime(1000);
    const actual = state.flashPhase;
    expect(actual).toBe(before);
  });
});
