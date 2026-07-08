import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { describe, expect, it } from 'vitest';
import { calculateCost, calculateCostSplit, getContextWindow, type MessageTokens, type MessageTokensSplit, reconstructCacheSplit } from '../src/private/pricing.js';
import { CacheTtl } from '../src/public/enums.js';

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

// ---------------------------------------------------------------------------
// calculateCostSplit — per-duration cache-creation pricing
// ---------------------------------------------------------------------------

function makeSplit(overrides: Partial<MessageTokensSplit> = {}): MessageTokensSplit {
  return {
    inputTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    ...overrides,
  };
}

// BetaUsage has many required fields; reconstructCacheSplit reads only the two
// cache fields, so a minimal object built with `as` is enough (cf. the codebase's
// AuditWriter.spec makeMessage `as BetaMessage`).
function makeUsage(fields: { flat?: number | null; ephemeral?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null }): BetaUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: fields.flat ?? null,
    cache_creation: fields.ephemeral ?? null,
  } as BetaUsage;
}

describe('calculateCostSplit — claude-fable-5', () => {
  it('prices 5m cache creation at the 5m rate ($12.50 / M)', () => {
    const expected = 12.5;
    const actual = calculateCostSplit(makeSplit({ cacheCreation5mTokens: 1_000_000 }), 'claude-fable-5');
    expect(actual).toBe(expected);
  });

  it('prices 1h cache creation at the 1h rate ($20 / M)', () => {
    const expected = 20;
    const actual = calculateCostSplit(makeSplit({ cacheCreation1hTokens: 1_000_000 }), 'claude-fable-5');
    expect(actual).toBe(expected);
  });

  it('sums a mixed 5m/1h breakdown at each rate', () => {
    const expected = 32.5; // 12.5 (5m) + 20 (1h)
    const actual = calculateCostSplit(makeSplit({ cacheCreation5mTokens: 1_000_000, cacheCreation1hTokens: 1_000_000 }), 'claude-fable-5');
    expect(actual).toBe(expected);
  });

  it('returns 0 for an unknown model', () => {
    const expected = 0;
    const actual = calculateCostSplit(makeSplit({ cacheCreation5mTokens: 1_000_000 }), 'claude-unknown-99');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// reconstructCacheSplit
// ---------------------------------------------------------------------------

describe('reconstructCacheSplit', () => {
  it('takes the 1h count from the message_start split', () => {
    const expected = 40;
    const actual = reconstructCacheSplit(makeUsage({ flat: 100, ephemeral: { ephemeral_5m_input_tokens: 25, ephemeral_1h_input_tokens: 40 } })).oneHour;
    expect(actual).toBe(expected);
  });

  it('derives 5m as the flat total minus 1h (server-tool cache shows as flat growth)', () => {
    const expected = 60; // flat 100 − 1h 40; message_start 5m was 25, the extra 35 is server-tool 5m
    const actual = reconstructCacheSplit(makeUsage({ flat: 100, ephemeral: { ephemeral_5m_input_tokens: 25, ephemeral_1h_input_tokens: 40 } })).fiveMinute;
    expect(actual).toBe(expected);
  });

  it('reports zero 1h when cache_creation is null', () => {
    const expected = 0;
    const actual = reconstructCacheSplit(makeUsage({ flat: 100, ephemeral: null })).oneHour;
    expect(actual).toBe(expected);
  });

  it('treats the whole flat total as 5m when cache_creation is null', () => {
    const expected = 100;
    const actual = reconstructCacheSplit(makeUsage({ flat: 100, ephemeral: null })).fiveMinute;
    expect(actual).toBe(expected);
  });
});


// ---------------------------------------------------------------------------
// calculateCost — claude-sonnet-5
// ---------------------------------------------------------------------------

describe('calculateCost — claude-sonnet-5', () => {
  it('charges $2 per million input tokens', () => {
    const expected = 2;

    const actual = calculateCost(makeTokens({ inputTokens: 1_000_000 }), 'claude-sonnet-5', CacheTtl.FiveMinutes);

    expect(actual).toBe(expected);
  });

  it('charges $10 per million output tokens', () => {
    const expected = 10;

    const actual = calculateCost(makeTokens({ outputTokens: 1_000_000 }), 'claude-sonnet-5', CacheTtl.FiveMinutes);

    expect(actual).toBe(expected);
  });

  it('charges $0.20 per million cache read tokens', () => {
    const expected = 0.2;

    const actual = calculateCost(makeTokens({ cacheReadTokens: 1_000_000 }), 'claude-sonnet-5', CacheTtl.FiveMinutes);

    expect(actual).toBe(expected);
  });

  it('charges $2.50 per million cache creation tokens at the 5m rate', () => {
    const expected = 2.5;

    const actual = calculateCost(makeTokens({ cacheCreationTokens: 1_000_000 }), 'claude-sonnet-5', CacheTtl.FiveMinutes);

    expect(actual).toBe(expected);
  });

  it('charges $4 per million cache creation tokens at the 1h rate', () => {
    const expected = 4;

    const actual = calculateCost(makeTokens({ cacheCreationTokens: 1_000_000 }), 'claude-sonnet-5', CacheTtl.OneHour);

    expect(actual).toBe(expected);
  });
});

describe('getContextWindow — claude-sonnet-5', () => {
  it('returns 1_000_000 for claude-sonnet-5', () => {
    const expected = 1_000_000;

    const actual = getContextWindow('claude-sonnet-5');

    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// calculateCost — date-suffixed model
// ---------------------------------------------------------------------------

describe('calculateCost — date-suffixed model', () => {
  it('strips the date suffix and charges the Sonnet 5 input rate', () => {
    const expected = 2;

    const actual = calculateCost(makeTokens({ inputTokens: 1_000_000 }), 'claude-sonnet-5-20260101', CacheTtl.FiveMinutes);

    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// calculateCost — unknown model in a known family
// ---------------------------------------------------------------------------

describe('calculateCost — unknown model in a known family', () => {
  it('charges the Sonnet family tail rate for an unmapped sonnet id', () => {
    const expected = 2;

    const actual = calculateCost(makeTokens({ inputTokens: 1_000_000 }), 'claude-sonnet-9', CacheTtl.FiveMinutes);

    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// getContextWindow — unknown family
// ---------------------------------------------------------------------------

describe('getContextWindow — unknown family', () => {
  it('returns 200_000 for a string with no recognised tier token', () => {
    const expected = 200_000;

    const actual = getContextWindow('claude-unknown-99');

    expect(actual).toBe(expected);
  });
});
