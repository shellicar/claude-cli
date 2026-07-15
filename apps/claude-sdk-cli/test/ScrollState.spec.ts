import { describe, expect, it } from 'vitest';
import { ScrollState } from '../src/model/ScrollState.js';

describe('ScrollState — defaults', () => {
  it('starts pinned to the bottom', () => {
    const expected = 0;
    const actual = new ScrollState().offset;
    expect(actual).toBe(expected);
  });

  it('reports not scrolled at the bottom', () => {
    const expected = false;
    const actual = new ScrollState().isScrolled;
    expect(actual).toBe(expected);
  });
});

describe('ScrollState — line movement', () => {
  it('moves back three lines per wheel notch', () => {
    const state = new ScrollState();
    state.measure(100, 10, 80);
    state.lineUp();
    const expected = 3;
    const actual = state.offset;
    expect(actual).toBe(expected);
  });

  it('cannot scroll past the top of the transcript', () => {
    const state = new ScrollState();
    state.measure(12, 10, 80); // maxOffset = 2
    state.lineUp();
    const expected = 2;
    const actual = state.offset;
    expect(actual).toBe(expected);
  });

  it('floors at the bottom when scrolling forward', () => {
    const state = new ScrollState();
    state.measure(100, 10, 80);
    state.lineDown();
    const expected = 0;
    const actual = state.offset;
    expect(actual).toBe(expected);
  });

  it('pages back by the visible height', () => {
    const state = new ScrollState();
    state.measure(100, 10, 80);
    state.pageUp();
    const expected = 10;
    const actual = state.offset;
    expect(actual).toBe(expected);
  });
});

describe('ScrollState — hold vs reflow', () => {
  it('holds absolute position when content is appended at the same width', () => {
    const state = new ScrollState();
    state.measure(100, 10, 80);
    state.lineUp(); // offset 3
    state.measure(105, 10, 80); // 5 lines appended
    const expected = 8;
    const actual = state.offset;
    expect(actual).toBe(expected);
  });

  it('scales the offset to anchor the same line when a narrower width rewraps more lines', () => {
    const state = new ScrollState();
    state.measure(100, 10, 80);
    state.pageUp();
    state.pageUp(); // offset 20
    state.measure(200, 10, 40); // reflow: half the width, twice the lines
    const expected = 40; // 20 * 200 / 100
    const actual = state.offset;
    expect(actual).toBe(expected);
  });

  it('clamps when a resize would anchor above the first line', () => {
    const state = new ScrollState();
    state.measure(100, 10, 80);
    state.pageUp();
    state.pageUp();
    state.pageUp(); // offset 30
    state.measure(15, 10, 80); // transcript shrank; maxOffset = 5
    const expected = 5;
    const actual = state.offset;
    expect(actual).toBe(expected);
  });
});

describe('ScrollState — emissions', () => {
  it('emits change on a user scroll', () => {
    const state = new ScrollState();
    state.measure(100, 10, 80);
    let count = 0;
    state.on('change', () => count++);
    state.lineUp();
    const expected = 1;
    const actual = count;
    expect(actual).toBe(expected);
  });

  it('does not emit when a scroll is a no-op at the bottom', () => {
    const state = new ScrollState();
    state.measure(100, 10, 80);
    let count = 0;
    state.on('change', () => count++);
    state.lineDown();
    const expected = 0;
    const actual = count;
    expect(actual).toBe(expected);
  });

  it('does not emit during measure', () => {
    const state = new ScrollState();
    state.measure(100, 10, 80);
    state.lineUp();
    let count = 0;
    state.on('change', () => count++);
    state.measure(120, 10, 80); // append while scrolled
    const expected = 0;
    const actual = count;
    expect(actual).toBe(expected);
  });
});
