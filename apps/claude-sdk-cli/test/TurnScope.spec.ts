import { describe, expect, it } from 'vitest';
import { TurnScope } from '../src/conv/TurnScope.js';

describe('TurnScope', () => {
  describe('turnId', () => {
    it('has no id before a turn begins', () => {
      const scope = new TurnScope();
      expect(scope.turnId).toBeUndefined();
    });

    it('is the id the turn began with', () => {
      const scope = new TurnScope();
      const expected = scope.begin();
      const actual = scope.turnId;
      expect(actual).toBe(expected);
    });
  });

  describe('begin', () => {
    it('mints a new id rather than reusing the turn before it', () => {
      const scope = new TurnScope();
      const previous = scope.begin();
      const actual = scope.begin();
      expect(actual).not.toBe(previous);
    });
  });
});
