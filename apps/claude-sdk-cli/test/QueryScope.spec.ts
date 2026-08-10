import { describe, expect, it } from 'vitest';
import { QueryScope } from '../src/conv/QueryScope.js';

const HUMAN = { kind: 'human' } as const;

describe('QueryScope', () => {
  describe('queryId', () => {
    it('has no id before a query begins', () => {
      const scope = new QueryScope();
      expect(scope.queryId).toBeUndefined();
    });

    it('is the id the query began with', () => {
      const scope = new QueryScope();
      const expected = scope.begin(HUMAN);
      const actual = scope.queryId;
      expect(actual).toBe(expected);
    });
  });

  describe('begin', () => {
    it('mints a new id rather than reusing the query before it', () => {
      const scope = new QueryScope();
      const previous = scope.begin(HUMAN);
      const actual = scope.begin(HUMAN);
      expect(actual).not.toBe(previous);
    });
  });
});
