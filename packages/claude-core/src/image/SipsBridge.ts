export type ImageDimensions = { readonly width: number; readonly height: number };

/** Formats sips can write. No webp: sips reads it but exits 13 when asked to produce it. */
export type SipsFormat = 'png' | 'jpeg' | 'gif';

/**
 * The child-process boundary for image conditioning — the one place the real `sips` binary runs.
 * Injected so `conditionImage` is tested without the binary. Every method rejects when sips is
 * absent, not invocable, or fails on the image; `conditionImage` turns any rejection into attach-as-is.
 */
export abstract class SipsBridge {
  public abstract dimensions(input: Buffer): Promise<ImageDimensions>;
  public abstract resize(input: Buffer, format: SipsFormat): Promise<Buffer>;
}
