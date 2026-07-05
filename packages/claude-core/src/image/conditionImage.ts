import type { SipsBridge } from './SipsBridge.js';
import type { ILogger } from '../logging/ILogger.js';

/** The image media types both attach paths already emit (paste: clipboard.ts detectMediaType; ReadFile: file-type sniff). */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export type ConditionedImage = { readonly data: Buffer; readonly mediaType: ImageMediaType };

/** Longest edge (px) an attached image may keep. Above this, downscale; at or below, leave as-is.
 *  A fixed safety number under the API's per-image dimension cap — deliberately not model-aware. */
export const MAX_LONG_EDGE = 2000;

/** sips argument vector that reads an image's pixel dimensions. */
export function buildDimensionArgs(inputPath: string): string[] {
  return ['-g', 'pixelWidth', '-g', 'pixelHeight', inputPath];
}

/** sips argument vector that downscales to a <=2000px long edge (aspect kept) and re-encodes as PNG.
 *  `-Z` never enlarges *once gated by dimensions* — it is only ever invoked here for an oversized image. */
export function buildResizeArgs(inputPath: string, outputPath: string): string[] {
  return ['-Z', String(MAX_LONG_EDGE), '-s', 'format', 'png', inputPath, '--out', outputPath];
}

/** Parse `pixelWidth: N` / `pixelHeight: N` out of `sips -g` stdout.
 *  Throws on output we cannot read, so an unreadable sips response degrades to attach-as-is
 *  (required by the "degrade, never fail" contract) rather than silently mis-gating the resize. */
export function parseDimensions(stdout: string): { width: number; height: number } {
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`sips returned unparseable dimensions: ${stdout}`);
  }
  return { width, height };
}

/**
 * Condition an image for attachment: downscale to a <=2000px long edge as PNG when it is larger,
 * otherwise leave it exactly as-is. Any sips problem (absent, not invocable, or a failure on this
 * image) degrades to the original bytes and media type — a conditioner must never block an attachment.
 *
 * Each outcome is logged the moment it happens (not aggregated at the call site) so the timestamp is
 * the real event time. The degrade path logs at `warn` because attaching an unconditioned image is the
 * one outcome an operator needs to notice in the field; the successful paths log at `debug`.
 */
export async function conditionImage(input: Buffer, mediaType: ImageMediaType, sips: SipsBridge, logger: ILogger): Promise<ConditionedImage> {
  try {
    const { width, height } = await sips.dimensions(input);
    logger.debug(`image conditioning: source image is ${width}x${height}px (${input.length} bytes)`);
    if (Math.max(width, height) <= MAX_LONG_EDGE) {
      logger.debug(`image conditioning: long edge is within ${MAX_LONG_EDGE}px, attaching unchanged`);
      return { data: input, mediaType };
    }
    const data = await sips.resizeToPng(input);
    logger.debug(`image conditioning: long edge exceeds ${MAX_LONG_EDGE}px, downscaled to a ${MAX_LONG_EDGE}px long edge and re-encoded as PNG (${input.length} -> ${data.length} bytes)`);
    return { data, mediaType: 'image/png' };
  } catch (error) {
    logger.warn(`image conditioning: sips unavailable or failed, attaching image unchanged (${input.length} bytes)`, { error });
    return { data: input, mediaType };
  }
}
