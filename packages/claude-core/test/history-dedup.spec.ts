import { describe, expect, it } from 'vitest';
import { type DedupConfig, estimateSimilarity, minhashSignature, nearDuplicateClusters, shingles } from '../src/history/dedup';

const CONFIG: DedupConfig = { shingleSize: 3, hashCount: 64, bands: 16, threshold: 0.7 };

describe('shingles', () => {
  it('slides a k-word window across the words', () => {
    const expected = ['the quick brown', 'quick brown fox'];

    const actual = shingles('the quick brown fox', 3);

    expect(actual).toEqual(expected);
  });

  it('lowercases before shingling', () => {
    const expected = ['the quick brown'];

    const actual = shingles('The Quick Brown', 3);

    expect(actual).toEqual(expected);
  });

  it('yields a single shingle when there are fewer words than k', () => {
    const expected = ['two words'];

    const actual = shingles('two words', 3);

    expect(actual).toEqual(expected);
  });

  it('yields nothing for text with no words', () => {
    const expected: string[] = [];

    const actual = shingles('   ', 3);

    expect(actual).toEqual(expected);
  });
});

describe('estimateSimilarity', () => {
  it('scores identical signatures at 1', () => {
    const signature = minhashSignature(shingles('the quick brown fox jumps', 3), 64);
    const expected = 1;

    const actual = estimateSimilarity(signature, signature);

    expect(actual).toBe(expected);
  });

  it('scores signatures of unrelated text below the threshold', () => {
    const a = minhashSignature(shingles('the quick brown fox jumps over', 3), 64);
    const b = minhashSignature(shingles('entirely unrelated words with nothing shared', 3), 64);

    const actual = estimateSimilarity(a, b);

    expect(actual).toBeLessThan(0.7);
  });
});

describe('nearDuplicateClusters', () => {
  it('clusters two identical texts', () => {
    const items = [
      { id: 'a', text: 'the quick brown fox jumps over the lazy dog' },
      { id: 'b', text: 'the quick brown fox jumps over the lazy dog' },
    ];
    const expected = 1;

    const actual = nearDuplicateClusters(items, CONFIG).length;

    expect(actual).toBe(expected);
  });

  it('makes the earliest item the canonical', () => {
    const items = [
      { id: 'first', text: 'the quick brown fox jumps over the lazy dog' },
      { id: 'second', text: 'the quick brown fox jumps over the lazy dog' },
    ];
    const expected = 'first';

    const actual = nearDuplicateClusters(items, CONFIG)[0].canonicalId;

    expect(actual).toBe(expected);
  });

  it('lists the later copies as the duplicates', () => {
    const items = [
      { id: 'first', text: 'the quick brown fox jumps over the lazy dog' },
      { id: 'second', text: 'the quick brown fox jumps over the lazy dog' },
    ];
    const expected = ['second'];

    const actual = nearDuplicateClusters(items, CONFIG)[0].duplicateIds;

    expect(actual).toEqual(expected);
  });

  it('does not cluster unrelated texts', () => {
    const items = [
      { id: 'a', text: 'the quick brown fox jumps over the lazy dog' },
      { id: 'b', text: 'entirely different content sharing none of the same words here' },
    ];
    const expected = 0;

    const actual = nearDuplicateClusters(items, CONFIG).length;

    expect(actual).toBe(expected);
  });

  it('clusters a near-identical copy that differs by one word', () => {
    const items = [
      { id: 'a', text: 'the quick brown fox jumps over the lazy dog in the meadow today' },
      { id: 'b', text: 'the quick brown fox jumps over the lazy dog in the meadow yesterday' },
    ];
    const expected = 1;

    const actual = nearDuplicateClusters(items, CONFIG).length;

    expect(actual).toBe(expected);
  });
});
