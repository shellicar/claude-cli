import { describe, expect, it } from 'vitest';
import type { ImageMediaType } from '../src/image/conditionImage';
import { buildDimensionArgs, buildResizeArgs, conditionImage, parseDimensions } from '../src/image/conditionImage';
import type { SipsBridge, SipsFormat } from '../src/image/SipsBridge';
import type { ILogger } from '../src/logging/ILogger';

const noopLogger: ILogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const RESIZED_BYTES = Buffer.from('conditioned-bytes');

const resizes: SipsBridge = {
  dimensions: () => Promise.resolve({ width: 4000, height: 3000 }),
  resize: () => Promise.resolve(RESIZED_BYTES),
};
const smallEnough: SipsBridge = {
  dimensions: () => Promise.resolve({ width: 1500, height: 800 }),
  resize: () => Promise.reject(new Error('resize must not be called for a small image')),
};
const absent: SipsBridge = {
  dimensions: () => Promise.reject(new Error('spawn sips ENOENT')),
  resize: () => Promise.reject(new Error('spawn sips ENOENT')),
};
const notInvocable: SipsBridge = {
  dimensions: () => Promise.reject(new Error('spawn sips EACCES')),
  resize: () => Promise.reject(new Error('spawn sips EACCES')),
};
const failsOnImage: SipsBridge = {
  dimensions: () => Promise.resolve({ width: 4000, height: 3000 }),
  resize: () => Promise.reject(new Error('sips exited 13')),
};

/** Records the format sips was asked to produce, so the mapping can be asserted at the boundary. */
const recordingBridge = () => {
  const formats: SipsFormat[] = [];
  const bridge: SipsBridge = {
    dimensions: () => Promise.resolve({ width: 4000, height: 3000 }),
    resize: (_input, format) => {
      formats.push(format);
      return Promise.resolve(RESIZED_BYTES);
    },
  };
  return { bridge, formats };
};

const formatAskedFor = async (mediaType: ImageMediaType): Promise<SipsFormat | undefined> => {
  const { bridge, formats } = recordingBridge();
  await conditionImage(Buffer.from('orig'), mediaType, bridge, noopLogger);
  return formats[0];
};

const mediaTypeReturned = async (mediaType: ImageMediaType): Promise<ImageMediaType> => {
  const { mediaType: actual } = await conditionImage(Buffer.from('orig'), mediaType, resizes, noopLogger);
  return actual;
};

describe('buildResizeArgs', () => {
  it('builds a 2000px downscale invocation in the requested format', () => {
    const expected = ['-Z', '2000', '-s', 'format', 'jpeg', '/tmp/in', '--out', '/tmp/out.jpeg'];
    const actual = buildResizeArgs('/tmp/in', '/tmp/out.jpeg', 'jpeg');
    expect(actual).toEqual(expected);
  });
});

describe('buildDimensionArgs', () => {
  it('builds a pixel-dimension query invocation', () => {
    const expected = ['-g', 'pixelWidth', '-g', 'pixelHeight', '/tmp/in'];
    const actual = buildDimensionArgs('/tmp/in');
    expect(actual).toEqual(expected);
  });
});

describe('parseDimensions', () => {
  it('reads pixelWidth and pixelHeight from sips output', () => {
    const expected = { width: 3000, height: 2000 };
    const actual = parseDimensions('/tmp/in\n  pixelWidth: 3000\n  pixelHeight: 2000\n');
    expect(actual).toEqual(expected);
  });
});

describe('conditionImage — resizes an oversized image', () => {
  it('uses the conditioned bytes', async () => {
    const expected = RESIZED_BYTES;
    const { data: actual } = await conditionImage(Buffer.from('orig'), 'image/jpeg', resizes, noopLogger);
    expect(actual).toBe(expected);
  });
});

describe('conditionImage — the format it asks sips to produce', () => {
  it('re-encodes a jpeg as jpeg', async () => {
    const expected = 'jpeg';
    const actual = await formatAskedFor('image/jpeg');
    expect(actual).toBe(expected);
  });

  it('re-encodes a png as png', async () => {
    const expected = 'png';
    const actual = await formatAskedFor('image/png');
    expect(actual).toBe(expected);
  });

  it('re-encodes a gif as gif', async () => {
    const expected = 'gif';
    const actual = await formatAskedFor('image/gif');
    expect(actual).toBe(expected);
  });

  it('re-encodes a webp as png, which sips can write', async () => {
    const expected = 'png';
    const actual = await formatAskedFor('image/webp');
    expect(actual).toBe(expected);
  });
});

describe('conditionImage — the media type it reports after resizing', () => {
  it('reports image/jpeg for a jpeg', async () => {
    const expected = 'image/jpeg';
    const actual = await mediaTypeReturned('image/jpeg');
    expect(actual).toBe(expected);
  });

  it('reports image/png for a png', async () => {
    const expected = 'image/png';
    const actual = await mediaTypeReturned('image/png');
    expect(actual).toBe(expected);
  });

  it('reports image/gif for a gif', async () => {
    const expected = 'image/gif';
    const actual = await mediaTypeReturned('image/gif');
    expect(actual).toBe(expected);
  });

  it('reports image/png for a webp', async () => {
    const expected = 'image/png';
    const actual = await mediaTypeReturned('image/webp');
    expect(actual).toBe(expected);
  });
});

describe('conditionImage — image within the cap', () => {
  it('returns the original bytes unchanged', async () => {
    const original = Buffer.from('small-original');
    const expected = original;
    const { data: actual } = await conditionImage(original, 'image/png', smallEnough, noopLogger);
    expect(actual).toBe(expected);
  });

  it('keeps the original media type', async () => {
    const expected = 'image/png';
    const { mediaType: actual } = await conditionImage(Buffer.from('small-original'), 'image/png', smallEnough, noopLogger);
    expect(actual).toBe(expected);
  });
});

describe('conditionImage — degrades to attach-as-is', () => {
  it('passes the original through when sips is absent', async () => {
    const original = Buffer.from('orig');
    const expected = original;
    const { data: actual } = await conditionImage(original, 'image/jpeg', absent, noopLogger);
    expect(actual).toBe(expected);
  });

  it('passes the original through when sips is not invocable', async () => {
    const original = Buffer.from('orig');
    const expected = original;
    const { data: actual } = await conditionImage(original, 'image/jpeg', notInvocable, noopLogger);
    expect(actual).toBe(expected);
  });

  it('passes the original through when sips fails on the image', async () => {
    const original = Buffer.from('orig');
    const expected = original;
    const { data: actual } = await conditionImage(original, 'image/jpeg', failsOnImage, noopLogger);
    expect(actual).toBe(expected);
  });

  it('keeps the original media type when sips fails on the image', async () => {
    const expected = 'image/jpeg';
    const { mediaType: actual } = await conditionImage(Buffer.from('orig'), 'image/jpeg', failsOnImage, noopLogger);
    expect(actual).toBe(expected);
  });
});
