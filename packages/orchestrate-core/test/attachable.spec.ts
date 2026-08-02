import { describe, expect, it } from 'vitest';
import { attachable } from '../src/attachable.js';

// The guard in front of the API. Anything that goes over as a document or an image has to be what
// it claims: a request the API rejects costs the whole turn, so a doubtful attachment is refused
// here and read as text instead.

const pdf = (body = 'body', trailer = '\n%%EOF\n') => Buffer.from(`%PDF-1.7\n${body}${trailer}`, 'binary');
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest')]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('rest'), Buffer.from([0xff, 0xd9])]);
const gif = () => Buffer.from('GIF89a....................', 'binary');
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0x00, 0x00, 0x00]), Buffer.from('WEBP'), Buffer.from('rest')]);

describe('bytes that are what they claim to be', () => {
  it('accepts a PDF', () => {
    const expected = true;
    const actual = attachable(pdf(), 'application/pdf');
    expect(actual).toBe(expected);
  });

  it('accepts a PNG', () => {
    const expected = true;
    const actual = attachable(png(), 'image/png');
    expect(actual).toBe(expected);
  });

  it('accepts a JPEG', () => {
    const expected = true;
    const actual = attachable(jpeg(), 'image/jpeg');
    expect(actual).toBe(expected);
  });

  it('accepts a GIF', () => {
    const expected = true;
    const actual = attachable(gif(), 'image/gif');
    expect(actual).toBe(expected);
  });

  it('accepts a WebP', () => {
    const expected = true;
    const actual = attachable(webp(), 'image/webp');
    expect(actual).toBe(expected);
  });
});

describe('bytes that are not what they claim to be', () => {
  it('refuses a PNG claimed as a PDF', () => {
    const expected = false;
    const actual = attachable(png(), 'application/pdf');
    expect(actual).toBe(expected);
  });

  it('refuses text claimed as an image', () => {
    const expected = false;
    const actual = attachable(Buffer.from('hello, world'), 'image/png');
    expect(actual).toBe(expected);
  });

  it('refuses nothing at all', () => {
    const expected = false;
    const actual = attachable(Buffer.alloc(0), 'application/pdf');
    expect(actual).toBe(expected);
  });

  it('refuses a type the API does not take', () => {
    const expected = false;
    const actual = attachable(Buffer.from('BM....'), 'image/bmp');
    expect(actual).toBe(expected);
  });
});

// `cat *.pdf` concatenates them, and what arrives starts with a PDF signature while being no PDF at
// all. Sending it costs the turn, so the end matters as much as the beginning.
describe('bytes that begin as a PDF but are not one', () => {
  it('refuses a PDF with no trailer', () => {
    const expected = false;
    const actual = attachable(pdf('body', ''), 'application/pdf');
    expect(actual).toBe(expected);
  });

  it('refuses two PDFs concatenated', () => {
    const expected = false;
    const actual = attachable(Buffer.concat([pdf(), pdf()]), 'application/pdf');
    expect(actual).toBe(expected);
  });
});

describe('bytes larger than a request can carry', () => {
  it('refuses them however well formed they are', () => {
    const enormous = Buffer.concat([Buffer.from('%PDF-1.7\n', 'binary'), Buffer.alloc(40 * 1024 * 1024), Buffer.from('\n%%EOF\n', 'binary')]);

    const expected = false;
    const actual = attachable(enormous, 'application/pdf');
    expect(actual).toBe(expected);
  });
});
