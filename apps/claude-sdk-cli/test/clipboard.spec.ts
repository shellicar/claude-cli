import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { looksLikePath, readClipboardPathCore, sanitiseFurlResult } from '../src/clipboard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a callable that resolves to `value`. */
const ok = (value: string | null) => () => Promise.resolve(value);

/** Returns a callable that rejects with an error. */
const fail =
  (msg = 'exec failed') =>
  () =>
    Promise.reject(new Error(msg));

// ---------------------------------------------------------------------------
// looksLikePath
// ---------------------------------------------------------------------------

describe('looksLikePath', () => {
  it.each([
    ['/absolute/path', true],
    ['/single', true],
    ['/', true],
    ['~/home/relative', true],
    ['~', true],
    ['./explicitly/relative', true],
    ['../parent/relative', true],
    ['./', true],
    ['../', true],
  ])('accepts %s → %s', (input, expected) => {
    expect(looksLikePath(input)).toBe(expected);
  });

  it.each([
    ['hello world', false],
    ['file.ts', false],
    ['', false],
    ['relative/no-dot-prefix', false],
    ['C:\\Windows\\Path', false],
    // multi-line strings are rejected
    ['/valid/path\nwith newline', false],
    ['/valid/path\rwith cr', false],
    // strings over 1 KB are rejected
    [`/${'a'.repeat(1024)}`, false],
  ])('rejects %s → %s', (input, expected) => {
    expect(looksLikePath(input)).toBe(expected);
  });

  it('accepts a string exactly 1 KB long', () => {
    // 1024 chars total: '/' + 1023 'a's
    const s = `/${'a'.repeat(1023)}`;
    expect(s.length).toBe(1024);
    expect(looksLikePath(s)).toBe(true);
  });

  it('rejects a string of exactly 1025 chars', () => {
    const s = `/${'a'.repeat(1024)}`;
    expect(s.length).toBe(1025);
    expect(looksLikePath(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readClipboardPathCore — stage-1 (pbpaste) wins
// ---------------------------------------------------------------------------

describe('readClipboardPathCore — pbpaste returns a path', () => {
  it('returns an absolute path directly from pbpaste', async () => {
    const result = await readClipboardPathCore(ok('/Users/stephen/file.ts'), fail());
    expect(result).toBe('/Users/stephen/file.ts');
  });

  it('trims surrounding whitespace from pbpaste output', async () => {
    const result = await readClipboardPathCore(ok('  /Users/stephen/file.ts  '), fail());
    expect(result).toBe('/Users/stephen/file.ts');
  });

  it('returns a home-relative path from pbpaste', async () => {
    const result = await readClipboardPathCore(ok('~/projects/my-app'), fail());
    expect(result).toBe('~/projects/my-app');
  });

  it('returns a ./-relative path from pbpaste (VS Code "Copy Relative Path")', async () => {
    const result = await readClipboardPathCore(ok('./apps/claude-sdk-cli/src/clipboard.ts'), fail());
    expect(result).toBe('./apps/claude-sdk-cli/src/clipboard.ts');
  });

  it('returns a ../-relative path from pbpaste', async () => {
    const result = await readClipboardPathCore(ok('../sibling/file.ts'), fail());
    expect(result).toBe('../sibling/file.ts');
  });
});

// ---------------------------------------------------------------------------
// readClipboardPathCore — stage-2 (osascript) fallback
// ---------------------------------------------------------------------------

describe('readClipboardPathCore — pbpaste does not give a path (Finder ⌘C fallback)', () => {
  it('falls through to osascript when pbpaste returns a bare filename', async () => {
    // Finder ⌘C: pbpaste gives just "file.ts", osascript gives the full POSIX path
    const result = await readClipboardPathCore(ok('file.ts'), ok('/Users/stephen/Desktop/file.ts'));
    expect(result).toBe('/Users/stephen/Desktop/file.ts');
  });

  it('falls through to osascript when pbpaste returns non-path text', async () => {
    const result = await readClipboardPathCore(ok('hello world'), ok('/Users/stephen/Desktop/file.ts'));
    expect(result).toBe('/Users/stephen/Desktop/file.ts');
  });

  it('falls through to osascript when pbpaste returns null (empty clipboard)', async () => {
    const result = await readClipboardPathCore(ok(null), ok('/Users/stephen/Desktop/file.ts'));
    expect(result).toBe('/Users/stephen/Desktop/file.ts');
  });

  it('falls through to osascript when pbpaste rejects', async () => {
    const result = await readClipboardPathCore(fail('pbpaste not found'), ok('/Users/stephen/Desktop/file.ts'));
    expect(result).toBe('/Users/stephen/Desktop/file.ts');
  });
});

// ---------------------------------------------------------------------------
// readClipboardPathCore — VS Code code/file-list probe (second file probe)
// ---------------------------------------------------------------------------

describe('readClipboardPathCore — VS Code code/file-list probe', () => {
  it('returns decoded POSIX path when VS Code probe resolves and pbpaste is empty', async () => {
    const result = await readClipboardPathCore(
      ok(null), // pbpaste: empty clipboard
      ok('/Users/stephen/projects/file.ts'), // vscode probe: already decoded POSIX path
      fail(), // osascript: should not be reached
    );
    expect(result).toBe('/Users/stephen/projects/file.ts');
  });

  it('skips a failing VS Code probe and falls through to the next probe', async () => {
    const result = await readClipboardPathCore(
      ok(null), // pbpaste: empty
      fail(), // vscode probe: type absent (rejects)
      ok('/Users/stephen/Desktop/file.ts'), // osascript: succeeds
    );
    expect(result).toBe('/Users/stephen/Desktop/file.ts');
  });

  it('uses the first succeeding file probe (VS Code wins over osascript)', async () => {
    const result = await readClipboardPathCore(ok(null), ok('/Users/stephen/projects/vscode.ts'), ok('/Users/stephen/projects/osascript.ts'));
    expect(result).toBe('/Users/stephen/projects/vscode.ts');
  });

  it('returns null when pbpaste gives non-path text and all file probes fail', async () => {
    const result = await readClipboardPathCore(ok('hello world'), fail(), fail());
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readClipboardPathCore — both stages fail → null
// ---------------------------------------------------------------------------

describe('readClipboardPathCore — nothing yields a path', () => {
  it('returns null when pbpaste returns non-path text and osascript returns null', async () => {
    const result = await readClipboardPathCore(ok('hello world'), ok(null));
    expect(result).toBeNull();
  });

  it('returns null when pbpaste returns non-path text and osascript rejects', async () => {
    // e.g. clipboard contains plain text — osascript -1700 error
    const result = await readClipboardPathCore(ok('hello world'), fail('osascript: -1700'));
    expect(result).toBeNull();
  });

  it('returns null when both pbpaste and osascript reject', async () => {
    const result = await readClipboardPathCore(fail(), fail());
    expect(result).toBeNull();
  });

  it('returns null when both return null', async () => {
    const result = await readClipboardPathCore(ok(null), ok(null));
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fileURLToPath — verify file URI → POSIX path decoding
// (documents what readVSCodeFileList relies on when the clipboard has %XX chars)
// ---------------------------------------------------------------------------

describe('fileURLToPath — file URI decoding for VS Code clipboard URIs', () => {
  it('converts a plain file URI to a POSIX path', () => {
    expect(fileURLToPath('file:///Users/stephen/projects/file.ts')).toBe('/Users/stephen/projects/file.ts');
  });

  it('percent-decodes %40 (@) in path segments — the real case from this repo', () => {
    // VS Code puts: file:///Users/stephen/repos/%40shellicar/claude-cli/apps/...
    expect(fileURLToPath('file:///Users/stephen/repos/%40shellicar/claude-cli/apps/claude-sdk-cli/build.ts')).toBe('/Users/stephen/repos/@shellicar/claude-cli/apps/claude-sdk-cli/build.ts');
  });

  it('percent-decodes spaces (%20) in path segments', () => {
    expect(fileURLToPath('file:///Users/stephen/My%20Projects/file.ts')).toBe('/Users/stephen/My Projects/file.ts');
  });
});

// ---------------------------------------------------------------------------
// sanitiseFurlResult — HFS artifact rejection
// ---------------------------------------------------------------------------

describe('sanitiseFurlResult', () => {
  it.each([
    // Genuine POSIX paths pass through unchanged
    ['/Users/stephen/file.ts', '/Users/stephen/file.ts'],
    ['/Users/stephen/repos/@shellicar/claude-cli/apps/build.ts', '/Users/stephen/repos/@shellicar/claude-cli/apps/build.ts'],
    ['/Applications/VS Code.app/', '/Applications/VS Code.app/'],
  ])('passes genuine POSIX path %s → %s', (input, expected) => {
    expect(sanitiseFurlResult(input)).toBe(expected);
  });

  it.each([
    // HFS artifacts from AppleScript coercing plain text (/ → :)
    ['/apps:claude-sdk-cli:src:clipboard.ts', null], // confirmed from real log output
    ['/apps:claude-sdk-cli:src:AppLayout.ts', null],
    ['Macintosh HD:Users:stephen:file.ts', null], // full HFS path without leading /
    ['/Users:stephen:file.ts', null], // partial HFS coercion
  ])('rejects HFS artifact %s → null', (input, expected) => {
    expect(sanitiseFurlResult(input)).toBe(expected);
  });

  it('returns null for null input', () => {
    expect(sanitiseFurlResult(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(sanitiseFurlResult('')).toBeNull();
  });
});
