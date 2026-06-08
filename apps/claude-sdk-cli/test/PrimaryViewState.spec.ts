import { describe, expect, it } from 'vitest';
import { PrimaryViewState } from '../src/model/PrimaryViewState.js';

describe('PrimaryViewState', () => {
  it('defaults the phase to editor', () => {
    const expected = 'editor';
    const actual = new PrimaryViewState().phase;
    expect(actual).toBe(expected);
  });

  it('updates the phase to streaming', () => {
    const state = new PrimaryViewState();
    state.setPhase('streaming');
    const expected = 'streaming';
    const actual = state.phase;
    expect(actual).toBe(expected);
  });

  it('emits change when the phase changes', () => {
    const state = new PrimaryViewState();
    let count = 0;
    state.on('change', () => count++);
    state.setPhase('streaming');
    const expected = 1;
    const actual = count;
    expect(actual).toBe(expected);
  });

  it('does not emit when the phase is unchanged', () => {
    const state = new PrimaryViewState();
    let count = 0;
    state.on('change', () => count++);
    state.setPhase('editor');
    const expected = 0;
    const actual = count;
    expect(actual).toBe(expected);
  });
});
