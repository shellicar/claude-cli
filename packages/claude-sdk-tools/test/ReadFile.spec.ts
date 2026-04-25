import { describe, expect, it } from 'vitest';
import { createReadFile } from '../src/ReadFile/ReadFile';
import type { ReadFileOutputFailure } from '../src/ReadFile/types';
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
  it('returns ReadFileBinarySuccess in textContent and document block in attachments for PDF', async () => {
    const pdfContent = '%PDF-1.4 fake content';
    const fs = new MemoryFileSystem({ '/docs/report.pdf': pdfContent });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf', mimeType: 'application/pdf' });

    expect(result.textContent).toMatchObject({
      type: 'binary',
      path: '/docs/report.pdf',
      mimeType: 'application/pdf',
      sizeKb: expect.any(Number),
    });
    expect((result.textContent as any).data).toBeUndefined();
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments?.[0]).toMatchObject({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: Buffer.from(pdfContent).toString('base64'),
      },
    });
  });

  it('rejects PDFs exceeding 32 MB', async () => {
    const bigContent = 'x'.repeat(33 * 1024 * 1024);
    const fs = new MemoryFileSystem({ '/docs/huge.pdf': bigContent });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/huge.pdf', mimeType: 'application/pdf' });

    expect(result.textContent).toMatchObject({ error: true, message: expect.stringContaining('too large') });
    expect(result.attachments).toBeUndefined();
  });

  it('rejects file that fails magic bytes check', async () => {
    const fs = new MemoryFileSystem({ '/docs/fake.pdf': 'not-a-pdf content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/fake.pdf', mimeType: 'application/pdf' });

    expect(result.textContent).toMatchObject({
      error: true,
      message: expect.stringContaining('does not match declared MIME type'),
    });
    expect(result.attachments).toBeUndefined();
  });

  it('text/plain returns PipeContent in textContent, no attachments', async () => {
    const fs = new MemoryFileSystem({ '/src/hello.ts': 'const a = 1;' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/src/hello.ts', mimeType: 'text/plain' });

    expect(result.textContent).toMatchObject({ type: 'content', values: ['const a = 1;'] });
    expect(result.attachments).toBeUndefined();
  });

  it('mimeType defaults to text/plain', async () => {
    const fs = new MemoryFileSystem({ '/src/hello.ts': 'line1' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/src/hello.ts' });

    expect(result.textContent).toMatchObject({ type: 'content' });
    expect(result.attachments).toBeUndefined();
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
  it('reads a GIF file with image/*', async () => {
    const fs = new MemoryFileSystem({ '/images/anim.gif': 'GIF89a fake content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/anim.gif', mimeType: 'image/*' });

    expect(result.textContent).toMatchObject({ type: 'binary', mimeType: 'image/gif' });
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments?.[0]).toMatchObject({ type: 'image', source: { media_type: 'image/gif' } });
  });

  it('reads a JPEG file with image/*', async () => {
    const fs = new MemoryFileSystem({ '/images/photo.jpg': jpegMagic });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/photo.jpg', mimeType: 'image/*' });

    expect(result.textContent).toMatchObject({ type: 'binary', mimeType: 'image/jpeg' });
    expect(result.attachments?.[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg' } });
  });

  it('reads a PNG file with image/*', async () => {
    const fs = new MemoryFileSystem({ '/images/icon.png': pngMagic });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/icon.png', mimeType: 'image/*' });

    expect(result.textContent).toMatchObject({ type: 'binary', mimeType: 'image/png' });
    expect(result.attachments?.[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
  });

  it('reads a WebP file with image/*', async () => {
    const fs = new MemoryFileSystem({ '/images/img.webp': webpMagic });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/img.webp', mimeType: 'image/*' });

    expect(result.textContent).toMatchObject({ type: 'binary', mimeType: 'image/webp' });
    expect(result.attachments?.[0]).toMatchObject({ type: 'image', source: { media_type: 'image/webp' } });
  });

  it('rejects a PDF when image/* is requested', async () => {
    const fs = new MemoryFileSystem({ '/docs/report.pdf': '%PDF-1.4 fake content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/docs/report.pdf', mimeType: 'image/*' });

    expect(result.textContent).toMatchObject({ error: true, message: expect.stringContaining('does not match') });
    expect(result.attachments).toBeUndefined();
  });

  it('rejects plain text when image/* is requested', async () => {
    const fs = new MemoryFileSystem({ '/src/hello.ts': 'const a = 1;' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/src/hello.ts', mimeType: 'image/*' });

    expect(result.textContent).toMatchObject({ error: true, message: expect.stringContaining('does not match') });
    expect(result.attachments).toBeUndefined();
  });

  it('rejects a GIF when application/pdf is requested', async () => {
    const fs = new MemoryFileSystem({ '/images/anim.gif': 'GIF89a fake content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/images/anim.gif', mimeType: 'application/pdf' });

    expect(result.textContent).toMatchObject({ error: true, message: expect.stringContaining('does not match') });
    expect(result.attachments).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// default branch — file-type detects an unsupported binary type
// ---------------------------------------------------------------------------

describe('createReadFile — unsupported binary type', () => {
  it('rejects a recognised but unsupported binary file read as text/plain', async () => {
    // ELF magic bytes (0x7F E L F) are all < 0x80 and survive UTF-8 encoding in MemoryFileSystem
    const fs = new MemoryFileSystem({ '/bin/tool': '\x7FELF fake elf content' });
    const ReadFile = createReadFile(fs);
    const result = await callFull(ReadFile, { path: '/bin/tool' });

    expect(result.textContent).toMatchObject({ error: true, message: expect.stringContaining('does not match') });
    expect(result.attachments).toBeUndefined();
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
