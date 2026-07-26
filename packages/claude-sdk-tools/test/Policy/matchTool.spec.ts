import { describe, expect, it } from 'vitest';
import { matchesTool } from '../../src/Policy/matchTool.js';

describe('matchesTool', () => {
  it('matches when the rule names the exact tool', () => {
    const expected = true;
    const actual = matchesTool('Program', 'Program');
    expect(actual).toBe(expected);
  });

  it('does not match a different tool name', () => {
    const expected = false;
    const actual = matchesTool('Program', 'Find');
    expect(actual).toBe(expected);
  });

  it('matches any name in a list', () => {
    const expected = true;
    const actual = matchesTool(['WriteMemory', 'ReadMemory'], 'ReadMemory');
    expect(actual).toBe(expected);
  });

  it('does not match a name absent from the list', () => {
    const expected = false;
    const actual = matchesTool(['WriteMemory', 'ReadMemory'], 'DeleteFile');
    expect(actual).toBe(expected);
  });

  it('matches any tool when the rule omits tool entirely', () => {
    const expected = true;
    const actual = matchesTool(undefined, 'AnythingAtAll');
    expect(actual).toBe(expected);
  });

  it('matches any tool when the rule names the wildcard', () => {
    const expected = true;
    const actual = matchesTool('*', 'AnythingAtAll');
    expect(actual).toBe(expected);
  });
});
