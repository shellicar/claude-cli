import { IGraphemeSegmenter } from './IGraphemeSegmenter.js';

export class IntlGraphemeSegmenter extends IGraphemeSegmenter {
  readonly #segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

  public segment(input: string): Intl.Segments {
    return this.#segmenter.segment(input);
  }
}
