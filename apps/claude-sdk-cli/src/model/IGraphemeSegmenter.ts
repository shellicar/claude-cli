/** Grapheme cluster segmentation; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IGraphemeSegmenter {
  public abstract segment(input: string): Intl.Segments;
}
