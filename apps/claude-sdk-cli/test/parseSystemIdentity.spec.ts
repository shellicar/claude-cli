import { describe, expect, it } from 'vitest';
import { parseSystemIdentity } from '../src/parseSystemIdentity.js';

describe('parseSystemIdentity', () => {
  it('extracts name from frontmatter', () => {
    const expected = 'planner';
    const actual = parseSystemIdentity('---\nname: planner\n---\nBody here').name;
    expect(actual).toBe(expected);
  });

  it('returns body without the frontmatter', () => {
    const expected = 'Body here';
    const actual = parseSystemIdentity('---\nname: planner\n---\nBody here').body;
    expect(actual).toBe(expected);
  });

  it('returns null name when frontmatter has no name key', () => {
    const expected = null;
    const actual = parseSystemIdentity('---\nrole: x\n---\nBody').name;
    expect(actual).toBe(expected);
  });

  it('returns null name when there is no frontmatter', () => {
    const expected = null;
    const actual = parseSystemIdentity('Just a body').name;
    expect(actual).toBe(expected);
  });

  it('treats the whole content as body when there is no frontmatter', () => {
    const expected = 'Just a body';
    const actual = parseSystemIdentity('Just a body').body;
    expect(actual).toBe(expected);
  });

  it('strips surrounding quotes from the name', () => {
    const expected = 'the planner';
    const actual = parseSystemIdentity('---\nname: "the planner"\n---\nB').name;
    expect(actual).toBe(expected);
  });

  it('returns null name when the frontmatter YAML is malformed', () => {
    const expected = null;
    const actual = parseSystemIdentity('---\nname: [unclosed\n---\nB').name;
    expect(actual).toBe(expected);
  });

  it('returns an empty body for an empty file', () => {
    const expected = '';
    const actual = parseSystemIdentity('').body;
    expect(actual).toBe(expected);
  });
});
