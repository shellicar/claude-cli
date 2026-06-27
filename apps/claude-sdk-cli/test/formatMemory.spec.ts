import { describe, expect, it } from 'vitest';
import { formatMemoryResult, formatMemorySummary } from '../src/controller/AgentMessageHandler.js';

describe('formatMemorySummary', () => {
  it('WriteMemory row shows intent, title, type and body length, not the body', () => {
    const expected = 'WriteMemory: noting a trap \u2014 "sqlite trap" [trap, 40 chars]';

    const actual = formatMemorySummary('WriteMemory', { intent: 'noting a trap', title: 'sqlite trap', type: 'trap', body: 'x'.repeat(40) });

    expect(actual).toBe(expected);
  });

  it('SearchMemory row shows the query and the type when given', () => {
    const expected = 'SearchMemory: finding traps \u2014 "sqlite" \u00b7 trap';

    const actual = formatMemorySummary('SearchMemory', { intent: 'finding traps', query: 'sqlite', type: 'trap' });

    expect(actual).toBe(expected);
  });

  it('ReadMemory row shows the id', () => {
    const expected = 'ReadMemory: reading it \u2014 abc';

    const actual = formatMemorySummary('ReadMemory', { intent: 'reading it', id: 'abc' });

    expect(actual).toBe(expected);
  });
});

describe('formatMemoryResult', () => {
  it('SearchMemory result line shows count and top title', () => {
    const expected = '3 hits \u00b7 "sqlite trap"';

    const actual = formatMemoryResult('SearchMemory', JSON.stringify({ count: 3, results: [{ title: 'sqlite trap' }] }));

    expect(actual).toBe(expected);
  });

  it('returns null for a non-search tool', () => {
    const actual = formatMemoryResult('WriteMemory', '{}');

    expect(actual).toBeNull();
  });
});
