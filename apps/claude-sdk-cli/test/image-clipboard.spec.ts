import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { detectMediaType, type ImageMediaType, readClipboardImageCore } from '../src/clipboard.js';
import { AttachmentStore } from '../src/model/AttachmentStore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a callable that resolves to a Buffer. */
const buf = (data: Buffer) => () => Promise.resolve(data);

/** Returns a callable that resolves to null. */
const empty = () => () => Promise.resolve(null as Buffer | null);

// ---------------------------------------------------------------------------
// PNG magic bytes: \x89PNG\r\n\x1a\n
// ---------------------------------------------------------------------------
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

// JPEG magic bytes: \xFF\xD8\xFF
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]);

// GIF87a magic bytes
const GIF87A_MAGIC = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00, 0x00]);

// GIF89a magic bytes
const GIF89A_MAGIC = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

// WebP magic bytes: RIFF....WEBP
const WEBP_MAGIC = Buffer.from([
  0x52,
  0x49,
  0x46,
  0x46, // RIFF
  0x00,
  0x00,
  0x00,
  0x00, // file size (placeholder)
  0x57,
  0x45,
  0x42,
  0x50, // WEBP
]);

// ---------------------------------------------------------------------------
// readClipboardImageCore
// ---------------------------------------------------------------------------

describe('readClipboardImageCore', () => {
  it('returns image result when first reader returns a Buffer', async () => {
    const expected = { kind: 'image', data: PNG_MAGIC };
    const actual = await readClipboardImageCore(buf(PNG_MAGIC));
    expect(actual).toEqual(expected);
  });

  it('tries second reader when first returns null', async () => {
    const expected = { kind: 'image', data: JPEG_MAGIC };
    const actual = await readClipboardImageCore(empty(), buf(JPEG_MAGIC));
    expect(actual).toEqual(expected);
  });

  it('returns empty when all readers return null', async () => {
    const expected = { kind: 'empty' };
    const actual = await readClipboardImageCore(empty(), empty());
    expect(actual).toEqual(expected);
  });

  it('returns unsupported when no readers provided', async () => {
    const expected = { kind: 'unsupported' };
    const actual = await readClipboardImageCore();
    expect(actual).toEqual(expected);
  });

  it('does not call subsequent readers after one succeeds', async () => {
    let secondCalled = false;
    const second = () => {
      secondCalled = true;
      return Promise.resolve(JPEG_MAGIC);
    };
    await readClipboardImageCore(buf(PNG_MAGIC), second);
    const expected = false;
    const actual = secondCalled;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// detectMediaType
// ---------------------------------------------------------------------------

describe('detectMediaType', () => {
  it('detects PNG from magic bytes', () => {
    const expected: ImageMediaType = 'image/png';
    const actual = detectMediaType(PNG_MAGIC);
    expect(actual).toBe(expected);
  });

  it('detects JPEG from magic bytes', () => {
    const expected: ImageMediaType = 'image/jpeg';
    const actual = detectMediaType(JPEG_MAGIC);
    expect(actual).toBe(expected);
  });

  it('detects GIF87a from magic bytes', () => {
    const expected: ImageMediaType = 'image/gif';
    const actual = detectMediaType(GIF87A_MAGIC);
    expect(actual).toBe(expected);
  });

  it('detects GIF89a from magic bytes', () => {
    const expected: ImageMediaType = 'image/gif';
    const actual = detectMediaType(GIF89A_MAGIC);
    expect(actual).toBe(expected);
  });

  it('detects WebP from magic bytes', () => {
    const expected: ImageMediaType = 'image/webp';
    const actual = detectMediaType(WEBP_MAGIC);
    expect(actual).toBe(expected);
  });

  it('returns null for unrecognised format', () => {
    const expected = null;
    const actual = detectMediaType(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]));
    expect(actual).toBe(expected);
  });

  it('returns null for empty buffer', () => {
    const expected = null;
    const actual = detectMediaType(Buffer.alloc(0));
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// AttachmentStore.addImage
// ---------------------------------------------------------------------------

describe('AttachmentStore.addImage', () => {
  it('stores image attachment with correct hash, base64, mediaType, sizeBytes', () => {
    const store = new AttachmentStore();
    store.addImage(PNG_MAGIC, 'image/png');

    const attachment = store.attachments[0];
    const expectedHash = createHash('sha256').update(PNG_MAGIC).digest('hex');
    const expectedBase64 = PNG_MAGIC.toString('base64');

    expect(attachment).toEqual({
      kind: 'image',
      hash: expectedHash,
      base64: expectedBase64,
      mediaType: 'image/png',
      sizeBytes: PNG_MAGIC.length,
    });
  });

  it('returns added on first add', () => {
    const store = new AttachmentStore();
    const expected = 'added';
    const actual = store.addImage(PNG_MAGIC, 'image/png');
    expect(actual).toBe(expected);
  });

  it('returns duplicate on duplicate add', () => {
    const store = new AttachmentStore();
    store.addImage(PNG_MAGIC, 'image/png');
    const expected = 'duplicate';
    const actual = store.addImage(PNG_MAGIC, 'image/png');
    expect(actual).toBe(expected);
  });

  it('deduplicates by content hash, not by reference', () => {
    const store = new AttachmentStore();
    const copy = Buffer.from(PNG_MAGIC);
    store.addImage(PNG_MAGIC, 'image/png');
    const expected = 'duplicate';
    const actual = store.addImage(copy, 'image/png');
    expect(actual).toBe(expected);
  });
});
