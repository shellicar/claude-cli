import { lines, lines as toLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { createReadBinaryFileToolV2 } from '../../src/Orchestrate/tools/ReadBinaryFile.js';
import { noopLogger, passthroughSips } from '../helpers.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

async function drain(stream: AsyncIterable<unknown>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of toLines(stream)) {
    out.push(String(value));
  }
  return out;
}

// A full PNG header (signature + IHDR) so file-type can sniff it; 8 bytes alone is too short.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const PDF = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< >>\nendobj\n');

describe('ReadBinaryFile tool — shape', () => {
  it('is fs.read tier', () => {
    const tool = createReadBinaryFileToolV2(new MemoryFileSystem(), passthroughSips, noopLogger);

    const expected = 'fs.read';
    const actual = tool.operation;
    expect(actual).toBe(expected);
  });

  it('is excluded from Orchestrate stages — its attachment output has nowhere to go mid-pipe', () => {
    const tool = createReadBinaryFileToolV2(new MemoryFileSystem(), passthroughSips, noopLogger);

    const expected = true;
    const actual = tool.excludeFromStages;
    expect(actual).toBe(expected);
  });
});

describe('ReadBinaryFile tool — PDF', () => {
  it('reports success and attaches a document block', async () => {
    const fs = new MemoryFileSystem({ '/doc.pdf': PDF });
    const tool = createReadBinaryFileToolV2(fs, passthroughSips, noopLogger);

    const { stdout, success, attachments } = tool.run({ path: '/doc.pdf' }, undefined, []);
    await drain(stdout);

    expect(success()).toBe(true);
    expect(attachments?.()).toEqual([{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF.toString('base64') } }]);
  });
});

describe('ReadBinaryFile tool — image', () => {
  it('reports success and attaches an image block', async () => {
    const fs = new MemoryFileSystem({ '/img.png': PNG });
    const tool = createReadBinaryFileToolV2(fs, passthroughSips, noopLogger);

    const { stdout, success, attachments } = tool.run({ path: '/img.png' }, undefined, []);
    await drain(stdout);

    expect(success()).toBe(true);
    expect(attachments?.()).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } }]);
  });
});

describe('ReadBinaryFile tool — validation', () => {
  it('reports failure and a stderr message for a text file — use Read instead', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'plain text content' });
    const tool = createReadBinaryFileToolV2(fs, passthroughSips, noopLogger);
    const stderr: string[] = [];

    const { stdout, success } = tool.run({ path: '/a.txt' }, undefined, stderr);
    await drain(stdout);

    expect(success()).toBe(false);
    expect(stderr[0]).toContain('use Read for text files');
  });

  it('reports failure for a missing file', async () => {
    const fs = new MemoryFileSystem();
    const tool = createReadBinaryFileToolV2(fs, passthroughSips, noopLogger);
    const stderr: string[] = [];

    const { stdout, success } = tool.run({ path: '/missing.pdf' }, undefined, stderr);
    await drain(stdout);

    expect(success()).toBe(false);
    expect(stderr[0]).toContain('File not found');
  });

  it('produces no attachment on failure', async () => {
    const fs = new MemoryFileSystem({ '/a.txt': 'plain text content' });
    const tool = createReadBinaryFileToolV2(fs, passthroughSips, noopLogger);

    const { stdout, attachments } = tool.run({ path: '/a.txt' }, undefined, []);
    await drain(stdout);

    expect(attachments?.()).toEqual([]);
  });
});
