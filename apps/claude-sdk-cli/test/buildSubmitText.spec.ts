import { describe, expect, it } from 'vitest';
import type { Attachment } from '../src/AttachmentStore.js';
import { buildSubmitText } from '../src/buildSubmitText.js';

// ---------------------------------------------------------------------------
// No attachments
// ---------------------------------------------------------------------------

describe('buildSubmitText — no attachments', () => {
  it('returns text unchanged when attachments is null', () => {
    const expected = 'hello world';
    const actual = buildSubmitText('hello world', null);
    expect(actual).toBe(expected);
  });

  it('returns text unchanged when attachments is empty', () => {
    const expected = 'hello world';
    const actual = buildSubmitText('hello world', []);
    expect(actual).toBe(expected);
  });

  it('returns empty string unchanged when no attachments', () => {
    const expected = '';
    const actual = buildSubmitText('', null);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Text attachments
// ---------------------------------------------------------------------------

describe('buildSubmitText — text attachment', () => {
  const textAtt: Attachment = {
    kind: 'text',
    hash: 'abc123',
    text: 'some content',
    sizeBytes: 12,
    fullSizeBytes: 12,
    truncated: false,
  };

  it('appends [attachment #1] block', () => {
    const result = buildSubmitText('prompt', [textAtt]);
    const expected = true;
    const actual = result.includes('[attachment #1]');
    expect(actual).toBe(expected);
  });

  it('includes the attachment text content', () => {
    const result = buildSubmitText('prompt', [textAtt]);
    const expected = true;
    const actual = result.includes('some content');
    expect(actual).toBe(expected);
  });

  it('includes [/attachment] closing tag', () => {
    const result = buildSubmitText('prompt', [textAtt]);
    const expected = true;
    const actual = result.includes('[/attachment]');
    expect(actual).toBe(expected);
  });

  it('starts with the main prompt text', () => {
    const result = buildSubmitText('my prompt', [textAtt]);
    const expected = true;
    const actual = result.startsWith('my prompt');
    expect(actual).toBe(expected);
  });

  it('does not include truncation notice when not truncated', () => {
    const result = buildSubmitText('prompt', [textAtt]);
    const expected = false;
    const actual = result.includes('truncated');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Truncated text attachment
// ---------------------------------------------------------------------------

describe('buildSubmitText — truncated text attachment', () => {
  const truncAtt: Attachment = {
    kind: 'text',
    hash: 'xyz',
    text: 'stored text',
    sizeBytes: 1024,
    fullSizeBytes: 2048,
    truncated: true,
  };

  it('includes truncation notice', () => {
    const result = buildSubmitText('prompt', [truncAtt]);
    const expected = true;
    const actual = result.includes('truncated');
    expect(actual).toBe(expected);
  });

  it('includes showing size in truncation notice', () => {
    const result = buildSubmitText('prompt', [truncAtt]);
    const expected = true;
    const actual = result.includes('showing');
    expect(actual).toBe(expected);
  });

  it('formats size in KB when >= 1024 bytes', () => {
    const result = buildSubmitText('prompt', [truncAtt]);
    const expected = true;
    const actual = result.includes('KB');
    expect(actual).toBe(expected);
  });

  it('formats size in bytes when < 1024', () => {
    const smallTrunc: Attachment = {
      kind: 'text',
      hash: 'small',
      text: 'x',
      sizeBytes: 500,
      fullSizeBytes: 800,
      truncated: true,
    };
    const result = buildSubmitText('prompt', [smallTrunc]);
    const expected = true;
    const actual = result.includes('500B');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// File attachments
// ---------------------------------------------------------------------------

describe('buildSubmitText — file attachment', () => {
  it('includes path for file attachment', () => {
    const att: Attachment = { kind: 'file', path: '/tmp/report.txt', fileType: 'file', sizeBytes: 2048 };
    const result = buildSubmitText('prompt', [att]);
    const expected = true;
    const actual = result.includes('path: /tmp/report.txt');
    expect(actual).toBe(expected);
  });

  it('includes type and size for file attachment', () => {
    const att: Attachment = { kind: 'file', path: '/tmp/report.txt', fileType: 'file', sizeBytes: 2048 };
    const result = buildSubmitText('prompt', [att]);
    const expected = true;
    const actual = result.includes('type: file') && result.includes('size:');
    expect(actual).toBe(expected);
  });

  it('includes type: dir for directory attachment', () => {
    const att: Attachment = { kind: 'file', path: '/tmp/mydir', fileType: 'dir' };
    const result = buildSubmitText('prompt', [att]);
    const expected = true;
    const actual = result.includes('type: dir');
    expect(actual).toBe(expected);
  });

  it('includes // not found for missing file', () => {
    const att: Attachment = { kind: 'file', path: '/tmp/gone.txt', fileType: 'missing' };
    const result = buildSubmitText('prompt', [att]);
    const expected = true;
    const actual = result.includes('// not found');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Multiple attachments
// ---------------------------------------------------------------------------

describe('buildSubmitText — multiple attachments', () => {
  const att1: Attachment = { kind: 'text', hash: 'h1', text: 'first', sizeBytes: 5, fullSizeBytes: 5, truncated: false };
  const att2: Attachment = { kind: 'file', path: '/tmp/second.txt', fileType: 'file', sizeBytes: 100 };

  it('numbers attachments starting at #1', () => {
    const result = buildSubmitText('prompt', [att1, att2]);
    const expected = true;
    const actual = result.includes('[attachment #1]');
    expect(actual).toBe(expected);
  });

  it('numbers second attachment #2', () => {
    const result = buildSubmitText('prompt', [att1, att2]);
    const expected = true;
    const actual = result.includes('[attachment #2]');
    expect(actual).toBe(expected);
  });

  it('both attachments appear in order', () => {
    const result = buildSubmitText('prompt', [att1, att2]);
    const pos1 = result.indexOf('[attachment #1]');
    const pos2 = result.indexOf('[attachment #2]');
    const expected = true;
    const actual = pos1 < pos2;
    expect(actual).toBe(expected);
  });
});
