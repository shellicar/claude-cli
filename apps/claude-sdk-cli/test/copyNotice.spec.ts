import { Instant } from '@js-joda/core';
import { describe, expect, it } from 'vitest';
import { StatusState } from '../src/model/StatusState.js';
import { copyNotice } from '../src/view/renderStatus.js';

const AT = Instant.parse('2026-08-09T00:00:00Z');
const secondsLater = (seconds: number): Instant => AT.plusSeconds(seconds);

const copied = (lines: number): StatusState => {
  const state = new StatusState('repo');
  state.markCopied(AT, lines);
  return state;
};

function plain(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI for test assertions
  return s.replace(/\x1b\[[^m]*m/g, '');
}

describe('copyNotice', () => {
  it('says nothing before anything has been copied', () => {
    const expected = '';
    const actual = copyNotice(new StatusState('repo'), AT);
    expect(actual).toBe(expected);
  });

  it('announces the copy at the moment it lands', () => {
    const expected = ' ✓ copied 3 lines';
    const actual = plain(copyNotice(copied(3), AT));
    expect(actual).toBe(expected);
  });

  it('says line rather than lines for a single line', () => {
    const expected = ' ✓ copied 1 line';
    const actual = plain(copyNotice(copied(1), AT));
    expect(actual).toBe(expected);
  });

  it('is still showing part way through its window', () => {
    const expected = ' ✓ copied 3 lines';
    const actual = plain(copyNotice(copied(3), secondsLater(1)));
    expect(actual).toBe(expected);
  });

  it('has gone once the window has passed', () => {
    const expected = '';
    const actual = copyNotice(copied(3), secondsLater(2));
    expect(actual).toBe(expected);
  });

  it('starts its window again when a second copy lands', () => {
    const expected = ' ✓ copied 9 lines';
    const state = copied(3);
    state.markCopied(secondsLater(5), 9);
    const actual = plain(copyNotice(state, secondsLater(6)));
    expect(actual).toBe(expected);
  });
});
