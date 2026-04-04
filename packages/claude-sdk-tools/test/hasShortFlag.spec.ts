import { describe, expect, it } from 'vitest';
import { hasShortFlag } from '../src/Exec/hasShortFlag';

describe('hasShortFlag', () => {
  describe('exact match', () => {
    it('matches -i exactly', () => {
      expect(hasShortFlag(['-i'], 'i')).toBe(true);
    });

    it('matches -n exactly', () => {
      expect(hasShortFlag(['-n'], 'n')).toBe(true);
    });

    it('returns false when exact flag absent', () => {
      expect(hasShortFlag(['-n'], 'i')).toBe(false);
    });
  });

  describe('combined short flags', () => {
    it('detects i inside -ni', () => {
      expect(hasShortFlag(['-ni'], 'i')).toBe(true);
    });

    it('detects n inside -ni', () => {
      expect(hasShortFlag(['-ni'], 'n')).toBe(true);
    });

    it('detects i inside -Ei', () => {
      expect(hasShortFlag(['-Ei'], 'i')).toBe(true);
    });

    it('detects E inside -Ei', () => {
      expect(hasShortFlag(['-Ei'], 'E')).toBe(true);
    });

    it('does not detect absent flag in combined group', () => {
      expect(hasShortFlag(['-ni'], 'E')).toBe(false);
    });
  });

  describe('long flags are ignored', () => {
    it('does not match --in-place for i', () => {
      expect(hasShortFlag(['--in-place'], 'i')).toBe(false);
    });

    it('does not match --ignore for i', () => {
      expect(hasShortFlag(['--ignore'], 'i')).toBe(false);
    });

    it('does not match --interactive for i', () => {
      expect(hasShortFlag(['--interactive'], 'i')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for empty args array', () => {
      expect(hasShortFlag([], 'i')).toBe(false);
    });

    it('returns false for arg without leading dash', () => {
      expect(hasShortFlag(['i'], 'i')).toBe(false);
    });

    it('returns false when no args contain the flag', () => {
      expect(hasShortFlag(['-a', '-b', '-c'], 'i')).toBe(false);
    });

    it('returns true when flag appears in one of several args', () => {
      expect(hasShortFlag(['-a', '-bi', '-c'], 'i')).toBe(true);
    });

    it('returns true when flag is in last arg', () => {
      expect(hasShortFlag(['-a', '-b', '-ci'], 'i')).toBe(true);
    });
  });
});
