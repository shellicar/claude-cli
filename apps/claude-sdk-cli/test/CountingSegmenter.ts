import type { IGraphemeSegmenter } from '../src/model/IGraphemeSegmenter.js';

/**
 * A real grapheme segmenter that also records how much text it was asked to segment.
 * Answers stay correct, so a test can assert behaviour and cost at the same time.
 */
export class CountingSegmenter implements IGraphemeSegmenter {
  readonly #inner = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  #codeUnitsSegmented = 0;

  /** Total code units passed to `segment` across every call. */
  public get codeUnitsSegmented(): number {
    return this.#codeUnitsSegmented;
  }

  public segment(input: string): Intl.Segments {
    this.#codeUnitsSegmented += input.length;
    return this.#inner.segment(input);
  }
}
