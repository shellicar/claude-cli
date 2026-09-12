import { describe, expect, it } from 'vitest';
import { tsServerFailureMessage } from '../src/typescript/TsServerClient.js';

describe('tsServerFailureMessage', () => {
  it('folds tsserver own reason into the message when one is present', () => {
    const expected = 'tsserver references failed for /abs/View.ts: file has not been opened';
    const actual = tsServerFailureMessage('references', '/abs/View.ts', 'file has not been opened');
    expect(actual).toBe(expected);
  });

  it('falls back to the generic message when tsserver sent no reason', () => {
    const expected = 'tsserver definition failed for /abs/View.ts';
    const actual = tsServerFailureMessage('definition', '/abs/View.ts', undefined);
    expect(actual).toBe(expected);
  });
});
