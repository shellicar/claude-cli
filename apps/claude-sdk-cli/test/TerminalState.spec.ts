import { describe, expect, it } from 'vitest';
import { TerminalState } from '../src/model/TerminalState.js';

describe('TerminalState — setSize', () => {
  it('updates cols', () => {
    const state = new TerminalState();
    state.setSize(100, 40);
    const expected = 100;
    const actual = state.cols;
    expect(actual).toBe(expected);
  });

  it('updates rows', () => {
    const state = new TerminalState();
    state.setSize(100, 40);
    const expected = 40;
    const actual = state.rows;
    expect(actual).toBe(expected);
  });

  it('emits change when the dimensions differ', () => {
    const state = new TerminalState();
    let count = 0;
    state.on('change', () => count++);
    state.setSize(100, 40);
    const expected = 1;
    const actual = count;
    expect(actual).toBe(expected);
  });

  it('does not emit when the dimensions are unchanged', () => {
    const state = new TerminalState();
    state.setSize(100, 40);
    let count = 0;
    state.on('change', () => count++);
    state.setSize(100, 40);
    const expected = 0;
    const actual = count;
    expect(actual).toBe(expected);
  });
});
