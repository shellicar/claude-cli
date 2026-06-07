import { describe, expect, it } from 'vitest';
import { getContextWindow } from '../src/private/pricing.js';

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
