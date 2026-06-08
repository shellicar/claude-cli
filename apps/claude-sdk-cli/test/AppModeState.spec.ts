import { describe, expect, it } from 'vitest';
import { AppModeState } from '../src/model/AppModeState.js';

describe('AppModeState', () => {
  it('defaults the active presentation to primary', () => {
    const expected = 'primary';
    const actual = new AppModeState().active;
    expect(actual).toBe(expected);
  });

  it('does not emit when setActive matches the current presentation', () => {
    const state = new AppModeState();
    let count = 0;
    state.on('change', () => count++);
    state.setActive('primary');
    const expected = 0;
    const actual = count;
    expect(actual).toBe(expected);
  });
});
