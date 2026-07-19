import { describe, expect, it } from 'vitest';
import { createAzInputSchema } from '../../src/Az/schema';

describe('createAzInputSchema', () => {
  describe('with exactly one configured account', () => {
    const schema = createAzInputSchema(['shellicar']);

    it('accepts input with account omitted', () => {
      const expected = true;
      const actual = schema.safeParse({ args: ['group', 'list'] }).success;
      expect(actual).toBe(expected);
    });

    it('accepts input with the account explicitly given', () => {
      const expected = true;
      const actual = schema.safeParse({ account: 'shellicar', args: ['group', 'list'] }).success;
      expect(actual).toBe(expected);
    });

    it('rejects an account name outside the configured enum', () => {
      const expected = false;
      const actual = schema.safeParse({ account: 'other', args: ['group', 'list'] }).success;
      expect(actual).toBe(expected);
    });
  });

  describe('with more than one configured account', () => {
    const schema = createAzInputSchema(['shellicar', 'hopeventures']);

    it('rejects input with account omitted', () => {
      const expected = false;
      const actual = schema.safeParse({ args: ['group', 'list'] }).success;
      expect(actual).toBe(expected);
    });

    it('accepts input naming one of the configured accounts', () => {
      const expected = true;
      const actual = schema.safeParse({ account: 'hopeventures', args: ['group', 'list'] }).success;
      expect(actual).toBe(expected);
    });

    it('rejects an account name outside the configured enum', () => {
      const expected = false;
      const actual = schema.safeParse({ account: 'other', args: ['group', 'list'] }).success;
      expect(actual).toBe(expected);
    });
  });

  it('rejects an empty args array', () => {
    const schema = createAzInputSchema(['shellicar']);
    const expected = false;
    const actual = schema.safeParse({ args: [] }).success;
    expect(actual).toBe(expected);
  });

  it('rejects unknown fields (strict schema)', () => {
    const schema = createAzInputSchema(['shellicar']);
    const expected = false;
    const actual = schema.safeParse({ args: ['group', 'list'], unexpected: true }).success;
    expect(actual).toBe(expected);
  });
});
