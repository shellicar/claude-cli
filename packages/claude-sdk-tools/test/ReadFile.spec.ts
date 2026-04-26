import { describe, expect, it } from 'vitest';
import { createReadFile } from '../src/ReadFile/ReadFile';
import type { ReadFileBinarySuccess, ReadFileOutputFailure } from '../src/ReadFile/types';
import { call, callFull } from './helpers';
import { MemoryFileSystem } from './MemoryFileSystem';

const makeFs = () =>
  new MemoryFileSystem({
    '/src/hello.ts': 'const a = 1;\nconst b = 2;\nconst c = 3;',
    '/src/single.ts': 'single line',
  });

describe('createReadFile \u2014 success', () => {
  it('returns lines as content output', async () => {
    const ReadFile = createReadFile(makeFs());
    const result = await call(ReadFile, { path: '/src/hello.ts' });
    expect(result).toMatchObject({
      type: 'content',
      values: ['const a = 1;', 'const b = 2;', 'const c = 3;'],
      totalLines: 3,
      path: '/src/hello.ts',
    });
  });

  it('returns a single-element array for a single-line file', async () => {
    const ReadFile = createReadFile(makeFs());
    const result = await call(ReadFile, { path: '/src/single.ts' });
    expect(result).toMatchObject({ type: 'content', values: ['single line'], totalLines: 1 });
  });

  it('returns correct totalLines matching values length', async () => {
    const ReadFile = createReadFile(makeFs());
    const result = await call(ReadFile, { path: '/src/hello.ts' });
    const content = result as { values: string[]; totalLines: number };
    expect(content.totalLines).toBe(content.values.length);
  });

  it('echoes the resolved path in the output', async () => {
    const ReadFile = createReadFile(makeFs());
    const result = await call(ReadFile, { path: '/src/hello.ts' });
    expect((result as { path: string }).path).toBe('/src/hello.ts');
  });
});

describe('createReadFile \u2014 error handling', () => {
  it('returns an error object for a missing file', async () => {
    const ReadFile = createReadFile(makeFs());
    const result = await call(ReadFile, { path: '/src/missing.ts' });
    expect(result).toMatchObject({ error: true, message: 'File not found', path: '/src/missing.ts' });
  });
});

describe('createReadFile — binary files (mimeType)', () => {
  it('textContent type is binary for PDF', async () => {
    const pdfContent = '%PDF-1.4 fake content';
    const fs = new MemoryFileSystem({ '/docs/report.pdf': pdfContent });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf', mimeType: 'application/pdf' });

    const expected = 'binary';
    const actual = (result.textContent as ReadFileBinarySuccess).type;
    expect(actual).toBe(expected);
  });

  it('textContent mimeType is application/pdf', async () => {
    const pdfContent = '%PDF-1.4 fake content';
    const fs = new MemoryFileSystem({ '/docs/report.pdf': pdfContent });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf', mimeType: 'application/pdf' });

    const expected = 'application/pdf';
    const actual = (result.textContent as ReadFileBinarySuccess).mimeType;
    expect(actual).toBe(expected);
  });

  it('textContent has no data field for PDF', async () => {
    const pdfContent = '%PDF-1.4 fake content';
    const fs = new MemoryFileSystem({ '/docs/report.pdf': pdfContent });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf', mimeType: 'application/pdf' });

    const expected = undefined;
    const actual = (result.textContent as any).data;
    expect(actual).toBe(expected);
  });

  it('attachments has one entry for PDF', async () => {
    const pdfContent = '%PDF-1.4 fake content';
    const fs = new MemoryFileSystem({ '/docs/report.pdf': pdfContent });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf', mimeType: 'application/pdf' });

    const expected = 1;
    const actual = result.attachments?.length;
    expect(actual).toBe(expected);
  });

  it('attachment type is document for PDF', async () => {
    const pdfContent = '%PDF-1.4 fake content';
    const fs = new MemoryFileSystem({ '/docs/report.pdf': pdfContent });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf', mimeType: 'application/pdf' });

    const expected = 'document';
    const actual = result.attachments?.[0]?.type;
    expect(actual).toBe(expected);
  });

  it('attachment source media_type is application/pdf', async () => {
    const pdfContent = '%PDF-1.4 fake content';
    const fs = new MemoryFileSystem({ '/docs/report.pdf': pdfContent });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf', mimeType: 'application/pdf' });

    const expected = 'application/pdf';
    const actual = result.attachments?.[0]?.source.media_type;
    expect(actual).toBe(expected);
  });

  it('attachment source data is base64 encoded file content', async () => {
    const pdfContent = '%PDF-1.4 fake content';
    const fs = new MemoryFileSystem({ '/docs/report.pdf': pdfContent });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf', mimeType: 'application/pdf' });

    const expected = Buffer.from(pdfContent).toString('base64');
    const actual = result.attachments?.[0]?.source.data;
    expect(actual).toBe(expected);
  });

  it('sets error flag for PDFs exceeding 32 MB', async () => {
    const bigContent = 'x'.repeat(33 * 1024 * 1024);
    const fs = new MemoryFileSystem({ '/docs/huge.pdf': bigContent });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/huge.pdf', mimeType: 'application/pdf' });

    const expected = true;
    const actual = (result.textContent as ReadFileOutputFailure).error;
    expect(actual).toBe(expected);
  });

  it('omits attachments for PDFs exceeding 32 MB', async () => {
    const bigContent = 'x'.repeat(33 * 1024 * 1024);
    const fs = new MemoryFileSystem({ '/docs/huge.pdf': bigContent });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/huge.pdf', mimeType: 'application/pdf' });

    const expected = undefined;
    const actual = result.attachments;
    expect(actual).toBe(expected);
  });

  it('sets error flag when file content does not match declared mime type', async () => {
    const fs = new MemoryFileSystem({ '/docs/fake.pdf': 'not-a-pdf content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/fake.pdf', mimeType: 'application/pdf' });

    const expected = true;
    const actual = (result.textContent as ReadFileOutputFailure).error;
    expect(actual).toBe(expected);
  });

  it('omits attachments when file content does not match declared mime type', async () => {
    const fs = new MemoryFileSystem({ '/docs/fake.pdf': 'not-a-pdf content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/fake.pdf', mimeType: 'application/pdf' });

    const expected = undefined;
    const actual = result.attachments;
    expect(actual).toBe(expected);
  });

  it('textContent type is content for text/plain', async () => {
    const fs = new MemoryFileSystem({ '/src/hello.ts': 'const a = 1;' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/src/hello.ts', mimeType: 'text/plain' });

    const expected = 'content';
    const actual = (result.textContent as any).type;
    expect(actual).toBe(expected);
  });

  it('omits attachments for text/plain', async () => {
    const fs = new MemoryFileSystem({ '/src/hello.ts': 'const a = 1;' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/src/hello.ts', mimeType: 'text/plain' });

    const expected = undefined;
    const actual = result.attachments;
    expect(actual).toBe(expected);
  });

  it('textContent type is content when mimeType defaults', async () => {
    const fs = new MemoryFileSystem({ '/src/hello.ts': 'line1' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/src/hello.ts' });

    const expected = 'content';
    const actual = (result.textContent as any).type;
    expect(actual).toBe(expected);
  });

  it('omits attachments when mimeType defaults', async () => {
    const fs = new MemoryFileSystem({ '/src/hello.ts': 'line1' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/src/hello.ts' });

    const expected = undefined;
    const actual = result.attachments;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// image/* wildcard
// ---------------------------------------------------------------------------

const jpegMagic = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(' fake jpeg')]);
const pngMagic = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
  Buffer.from([0x00, 0x00, 0x00, 0x0d]), // IHDR chunk length (13)
  Buffer.from([0x49, 0x48, 0x44, 0x52]), // 'IHDR'
  Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00]), // 1x1 RGB
]);
const webpMagic = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.from('WEBP'), Buffer.from(' fake webp')]);

describe('createReadFile — image/* wildcard', () => {
  it('detects GIF mimeType from content', async () => {
    const fs = new MemoryFileSystem({ '/images/anim.gif': 'GIF89a fake content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/anim.gif', mimeType: 'image/*' });

    const expected = 'image/gif';
    const actual = (result.textContent as ReadFileBinarySuccess).mimeType;
    expect(actual).toBe(expected);
  });

  it('returns an image attachment for GIF', async () => {
    const fs = new MemoryFileSystem({ '/images/anim.gif': 'GIF89a fake content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/anim.gif', mimeType: 'image/*' });

    const expected = 'image/gif';
    const actual = result.attachments?.[0]?.source.media_type;
    expect(actual).toBe(expected);
  });

  it('detects JPEG mimeType from content', async () => {
    const fs = new MemoryFileSystem({ '/images/photo.jpg': jpegMagic });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/photo.jpg', mimeType: 'image/*' });

    const expected = 'image/jpeg';
    const actual = (result.textContent as ReadFileBinarySuccess).mimeType;
    expect(actual).toBe(expected);
  });

  it('returns an image attachment for JPEG', async () => {
    const fs = new MemoryFileSystem({ '/images/photo.jpg': jpegMagic });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/photo.jpg', mimeType: 'image/*' });

    const expected = 'image/jpeg';
    const actual = result.attachments?.[0]?.source.media_type;
    expect(actual).toBe(expected);
  });

  it('detects PNG mimeType from content', async () => {
    const fs = new MemoryFileSystem({ '/images/icon.png': pngMagic });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/icon.png', mimeType: 'image/*' });

    const expected = 'image/png';
    const actual = (result.textContent as ReadFileBinarySuccess).mimeType;
    expect(actual).toBe(expected);
  });

  it('returns an image attachment for PNG', async () => {
    const fs = new MemoryFileSystem({ '/images/icon.png': pngMagic });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/icon.png', mimeType: 'image/*' });

    const expected = 'image/png';
    const actual = result.attachments?.[0]?.source.media_type;
    expect(actual).toBe(expected);
  });

  it('detects WebP mimeType from content', async () => {
    const fs = new MemoryFileSystem({ '/images/img.webp': webpMagic });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/img.webp', mimeType: 'image/*' });

    const expected = 'image/webp';
    const actual = (result.textContent as ReadFileBinarySuccess).mimeType;
    expect(actual).toBe(expected);
  });

  it('returns an image attachment for WebP', async () => {
    const fs = new MemoryFileSystem({ '/images/img.webp': webpMagic });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/img.webp', mimeType: 'image/*' });

    const expected = 'image/webp';
    const actual = result.attachments?.[0]?.source.media_type;
    expect(actual).toBe(expected);
  });

  it('sets error flag when a PDF is requested as image/*', async () => {
    const fs = new MemoryFileSystem({ '/docs/report.pdf': '%PDF-1.4 fake content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf', mimeType: 'image/*' });

    const expected = true;
    const actual = (result.textContent as ReadFileOutputFailure).error;
    expect(actual).toBe(expected);
  });

  it('omits attachments when a PDF is requested as image/*', async () => {
    const fs = new MemoryFileSystem({ '/docs/report.pdf': '%PDF-1.4 fake content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf', mimeType: 'image/*' });

    const expected = undefined;
    const actual = result.attachments;
    expect(actual).toBe(expected);
  });

  it('sets error flag when plain text is requested as image/*', async () => {
    const fs = new MemoryFileSystem({ '/src/hello.ts': 'const a = 1;' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/src/hello.ts', mimeType: 'image/*' });

    const expected = true;
    const actual = (result.textContent as ReadFileOutputFailure).error;
    expect(actual).toBe(expected);
  });

  it('omits attachments when plain text is requested as image/*', async () => {
    const fs = new MemoryFileSystem({ '/src/hello.ts': 'const a = 1;' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/src/hello.ts', mimeType: 'image/*' });

    const expected = undefined;
    const actual = result.attachments;
    expect(actual).toBe(expected);
  });

  it('sets error flag when a GIF is requested as application/pdf', async () => {
    const fs = new MemoryFileSystem({ '/images/anim.gif': 'GIF89a fake content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/anim.gif', mimeType: 'application/pdf' });

    const expected = true;
    const actual = (result.textContent as ReadFileOutputFailure).error;
    expect(actual).toBe(expected);
  });

  it('omits attachments when a GIF is requested as application/pdf', async () => {
    const fs = new MemoryFileSystem({ '/images/anim.gif': 'GIF89a fake content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/anim.gif', mimeType: 'application/pdf' });

    const expected = undefined;
    const actual = result.attachments;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// default branch — file-type detects an unsupported binary type
// ---------------------------------------------------------------------------

describe('createReadFile — unsupported binary type', () => {
  it('sets error flag for a recognised but unsupported binary file read as text/plain', async () => {
    // ELF magic bytes (0x7F E L F) are all < 0x80 and survive UTF-8 encoding in MemoryFileSystem
    const fs = new MemoryFileSystem({ '/bin/tool': '\x7FELF fake elf content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/bin/tool' });

    const expected = true;
    const actual = (result.textContent as ReadFileOutputFailure).error;
    expect(actual).toBe(expected);
  });

  it('omits attachments for a recognised but unsupported binary file read as text/plain', async () => {
    const fs = new MemoryFileSystem({ '/bin/tool': '\x7FELF fake elf content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/bin/tool' });

    const expected = undefined;
    const actual = result.attachments;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// mime type mismatch
// ---------------------------------------------------------------------------

describe('createReadFile — mime type mismatch', () => {
  it('sets error flag when a PDF file is read as text/plain', async () => {
    const fs = new MemoryFileSystem({ '/docs/report.pdf': '%PDF-1.4 fake content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf' });

    const expected = true;
    const actual = (result.textContent as ReadFileOutputFailure).error;
    expect(actual).toBe(expected);
  });

  it('omits attachments when a PDF file is read as text/plain', async () => {
    const fs = new MemoryFileSystem({ '/docs/report.pdf': '%PDF-1.4 fake content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf' });

    const expected = undefined;
    const actual = result.attachments;
    expect(actual).toBe(expected);
  });

  it('sets error flag when a GIF file is read as text/plain', async () => {
    // GIF magic bytes 'GIF8' are ASCII — correct round-trip through MemoryFileSystem
    const fs = new MemoryFileSystem({ '/images/anim.gif': 'GIF89a fake content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/anim.gif' });

    const expected = true;
    const actual = (result.textContent as ReadFileOutputFailure).error;
    expect(actual).toBe(expected);
  });
});
