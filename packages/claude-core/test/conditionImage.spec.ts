import { describe, expect, it } from 'vitest';
import { buildDimensionArgs, buildResizeArgs, conditionImage, parseDimensions } from '../src/image/conditionImage';
import type { SipsBridge } from '../src/image/SipsBridge';

const PNG_BYTES = Buffer.from('conditioned-png-bytes');

const resizes: SipsBridge = {
  dimensions: () => Promise.resolve({ width: 4000, height: 3000 }),
  resizeToPng: () => Promise.resolve(PNG_BYTES),
};
const smallEnough: SipsBridge = {
  dimensions: () => Promise.resolve({ width: 1500, height: 800 }),
  resizeToPng: () => Promise.reject(new Error('resize must not be called for a small image')),
};
const absent: SipsBridge = {
  dimensions: () => Promise.reject(new Error('spawn sips ENOENT')),
  resizeToPng: () => Promise.reject(new Error('spawn sips ENOENT')),
};
const notInvocable: SipsBridge = {
  dimensions: () => Promise.reject(new Error('spawn sips EACCES')),
  resizeToPng: () => Promise.reject(new Error('spawn sips EACCES')),
};
const failsOnImage: SipsBridge = {
  dimensions: () => Promise.resolve({ width: 4000, height: 3000 }),
  resizeToPng: () => Promise.reject(new Error('sips exited 13')),
};

describe('buildResizeArgs', () => {
  it('builds a 2000px downscale-to-PNG sips invocation', () => {
    const expected = ['-Z', '2000', '-s', 'format', 'png', '/tmp/in', '--out', '/tmp/out.png'];
    const actual = buildResizeArgs('/tmp/in', '/tmp/out.png');
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
    const expected = PNG_BYTES;
    const { data: actual } = await conditionImage(Buffer.from('orig'), 'image/jpeg', resizes);
    expect(actual).toBe(expected);
  });

  it('reports image/png after resizing', async () => {
    const expected = 'image/png';
    const { mediaType: actual } = await conditionImage(Buffer.from('orig'), 'image/jpeg', resizes);
    expect(actual).toBe(expected);
  });
});

describe('conditionImage — image within the cap', () => {
  it('returns the original bytes unchanged', async () => {
    const original = Buffer.from('small-original');
    const expected = original;
    const { data: actual } = await conditionImage(original, 'image/png', smallEnough);
    expect(actual).toBe(expected);
  });

  it('keeps the original media type', async () => {
    const expected = 'image/png';
    const { mediaType: actual } = await conditionImage(Buffer.from('small-original'), 'image/png', smallEnough);
    expect(actual).toBe(expected);
  });
});

describe('conditionImage — degrades to attach-as-is', () => {
  it('passes the original through when sips is absent', async () => {
    const original = Buffer.from('orig');
    const expected = original;
    const { data: actual } = await conditionImage(original, 'image/jpeg', absent);
    expect(actual).toBe(expected);
  });

  it('passes the original through when sips is not invocable', async () => {
    const original = Buffer.from('orig');
    const expected = original;
    const { data: actual } = await conditionImage(original, 'image/jpeg', notInvocable);
    expect(actual).toBe(expected);
  });

  it('passes the original through when sips fails on the image', async () => {
    const original = Buffer.from('orig');
    const expected = original;
    const { data: actual } = await conditionImage(original, 'image/jpeg', failsOnImage);
    expect(actual).toBe(expected);
  });

  it('keeps the original media type when sips fails on the image', async () => {
    const expected = 'image/jpeg';
    const { mediaType: actual } = await conditionImage(Buffer.from('orig'), 'image/jpeg', failsOnImage);
    expect(actual).toBe(expected);
  });
});
