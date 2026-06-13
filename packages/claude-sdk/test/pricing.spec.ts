import { describe, expect, it } from 'vitest';
import { CacheTtl } from '../src/public/enums.js';
import { calculateCost, getContextWindow, type MessageTokens } from '../src/private/pricing.js';


// ---------------------------------------------------------------------------
// getContextWindow
// ---------------------------------------------------------------------------

describe('getContextWindow', () => {
  describe('pinned 1M models', () => {
    it('returns 1_000_000 for claude-opus-4-8 (pinned)', () => {
      const expected = 1_000_000;

      const actual = getContextWindow('claude-opus-4-8');

      expect(actual).toBe(expected);
    });

    it('returns 1_000_000 for claude-sonnet-4-6 (pinned)', () => {
      const expected = 1_000_000;

      const actual = getContextWindow('claude-sonnet-4-6');

      expect(actual).toBe(expected);
    });
  });

  describe('family fallback — opus and sonnet resolve to 1M', () => {
    it('returns 1_000_000 for claude-opus-4-9 (unmapped opus)', () => {
      const expected = 1_000_000;

      const actual = getContextWindow('claude-opus-4-9');

      expect(actual).toBe(expected);
    });

    it('returns 1_000_000 for claude-sonnet-4-7 (unmapped sonnet)', () => {
      const expected = 1_000_000;

      const actual = getContextWindow('claude-sonnet-4-7');

      expect(actual).toBe(expected);
    });
  });

  describe('family fallback — haiku resolves to 200k', () => {
    it('returns 200_000 for claude-haiku-4-5 (pinned)', () => {
      const expected = 200_000;

      const actual = getContextWindow('claude-haiku-4-5');

      expect(actual).toBe(expected);
    });

    it('returns 200_000 for claude-haiku-4-6 (unmapped haiku)', () => {
      const expected = 200_000;

      const actual = getContextWindow('claude-haiku-4-6');

      expect(actual).toBe(expected);
    });
  });

  describe('pinned 200k models beat family fallback', () => {
    it('returns 200_000 for claude-opus-4 despite opus family default', () => {
      const expected = 200_000;

      const actual = getContextWindow('claude-opus-4');

      expect(actual).toBe(expected);
    });

    it('returns 200_000 for claude-opus-4-5 despite opus family default', () => {
      const expected = 200_000;

      const actual = getContextWindow('claude-opus-4-5');

      expect(actual).toBe(expected);
    });

    it('returns 200_000 for claude-opus-4-1 despite opus family default', () => {
      const expected = 200_000;

      const actual = getContextWindow('claude-opus-4-1');

      expect(actual).toBe(expected);
    });

    it('returns 200_000 for claude-sonnet-3-7 despite sonnet family default', () => {
      const expected = 200_000;

      const actual = getContextWindow('claude-sonnet-3-7');

      expect(actual).toBe(expected);
    });
  });
});


// ---------------------------------------------------------------------------
// calculateCost — helpers
// ---------------------------------------------------------------------------

function makeTokens(overrides: Partial<MessageTokens> = {}): MessageTokens {
  return {
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// calculateCost — claude-fable-5
// ---------------------------------------------------------------------------

describe('calculateCost — claude-fable-5', () => {
  it('charges $10 per million input tokens', () => {
    const expected = 10;

    const actual = calculateCost(makeTokens({ inputTokens: 1_000_000 }), 'claude-fable-5', CacheTtl.FiveMinutes);

    expect(actual).toBe(expected);
  });

  it('charges $50 per million output tokens', () => {
    const expected = 50;

    const actual = calculateCost(makeTokens({ outputTokens: 1_000_000 }), 'claude-fable-5', CacheTtl.FiveMinutes);

    expect(actual).toBe(expected);
  });

  it('charges $1 per million cache read tokens', () => {
    const expected = 1;

    const actual = calculateCost(makeTokens({ cacheReadTokens: 1_000_000 }), 'claude-fable-5', CacheTtl.FiveMinutes);

    expect(actual).toBe(expected);
  });

  it('charges $12.50 per million cache creation tokens at the 5m rate', () => {
    const expected = 12.5;

    const actual = calculateCost(makeTokens({ cacheCreationTokens: 1_000_000 }), 'claude-fable-5', CacheTtl.FiveMinutes);

    expect(actual).toBe(expected);
  });

  it('charges $20 per million cache creation tokens at the 1h rate', () => {
    const expected = 20;

    const actual = calculateCost(makeTokens({ cacheCreationTokens: 1_000_000 }), 'claude-fable-5', CacheTtl.OneHour);

    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// calculateCost — unknown model
// ---------------------------------------------------------------------------

describe('calculateCost — unknown model', () => {
  it('returns 0 for an unknown model', () => {
    const expected = 0;

    const actual = calculateCost(makeTokens({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), 'claude-unknown-99', CacheTtl.FiveMinutes);

    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// getContextWindow — claude-fable-5
// ---------------------------------------------------------------------------

describe('getContextWindow — claude-fable-5', () => {
  it('returns 1_000_000 for claude-fable-5', () => {
    const expected = 1_000_000;

    const actual = getContextWindow('claude-fable-5');

    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// getContextWindow — unknown fable id
// ---------------------------------------------------------------------------

describe('getContextWindow — unknown fable id', () => {
  it('returns 1_000_000 for claude-fable-6 (unknown fable fails forward to family minimum)', () => {
    const expected = 1_000_000;

    const actual = getContextWindow('claude-fable-6');

    expect(actual).toBe(expected);
  });
});
