import { describe, expect, it } from 'vitest';
import { createReadFile } from '../src/ReadFile/ReadFile';
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

describe('createReadFile — size limit', () => {
  it('returns an error for files exceeding the size limit', async () => {
    const bigContent = 'x'.repeat(501_000);
    const fs = new MemoryFileSystem({ '/logs/huge.log': bigContent });
    const ReadFile = createReadFile(fs);
    const result = await call(ReadFile, { path: '/logs/huge.log' });
    expect(result).toMatchObject({
      error: true,
      message: expect.stringContaining('too large'),
      path: '/logs/huge.log',
    });
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
