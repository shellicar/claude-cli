import { describe, expect, it } from 'vitest';
import { AzInputSchema } from '../../src/Az/schema';

describe('AzInputSchema', () => {
  it('accepts input with account omitted', () => {
    const expected = true;
    const actual = AzInputSchema.safeParse({ args: ['group', 'list'] }).success;
    expect(actual).toBe(expected);
  });

  it('accepts input with an account name given', () => {
    const expected = true;
    const actual = AzInputSchema.safeParse({ account: 'shellicar', args: ['group', 'list'] }).success;
    expect(actual).toBe(expected);
  });

  it('rejects an empty args array', () => {
    const expected = false;
    const actual = AzInputSchema.safeParse({ args: [] }).success;
    expect(actual).toBe(expected);
  });

  it('rejects unknown fields (strict schema)', () => {
    const expected = false;
    const actual = AzInputSchema.safeParse({ args: ['group', 'list'], unexpected: true }).success;
    expect(actual).toBe(expected);
  });
});
