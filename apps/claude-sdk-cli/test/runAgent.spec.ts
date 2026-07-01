import { describe, expect, it } from 'vitest';
import { buildRunAgentInput } from '../src/runAgent.js';

describe('buildRunAgentInput', () => {
  it('returns a null message on resume', () => {
    const actual = buildRunAgentInput({ text: '', images: [], resume: true }).message;
    expect(actual).toBeNull();
  });

  it('returns an empty displayText on resume', () => {
    const actual = buildRunAgentInput({ text: '', images: [], resume: true }).displayText;
    expect(actual).toBe('');
  });

  it('builds a user message for a normal text input', () => {
    const expected = { role: 'user', content: [{ type: 'text', text: 'hello' }] };
    const actual = buildRunAgentInput({ text: 'hello', images: [] }).message;
    expect(actual).toEqual(expected);
  });
});
