import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';

function execText(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
      if (error) {
        reject(new Error(`${command} failed: ${error.message}`));
        return;
      }
      const text = stdout.trim();
      resolve(text.length > 0 ? text : null);
    });
  });
}

const MAX_IMAGE_BUFFER = 50 * 1024 * 1024;

function execBuffer(command: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'buffer', timeout: 5000, maxBuffer: MAX_IMAGE_BUFFER }, (error, stdout) => {
      if (error) {
        reject(new Error(`${command} failed: ${error.message}`));
        return;
      }
      resolve(stdout && stdout.length > 0 ? stdout : null);
    });
  });
}

/** Read plain text from the system clipboard. Returns null if empty or unavailable. */
export async function readClipboardText(): Promise<string | null> {
  return execText('pbpaste', []);
}

/**
 * Return true if the string looks like an absolute, home-relative,
 * explicitly-relative, or bare-relative filesystem path.
 *
 * Accepts:
 *   /absolute/path
 *   ~/home/relative
 *   ./explicitly/relative       (explicit ./ prefix)
 *   ../parent/relative          (explicit ../ prefix)
 *   apps/foo/bar.ts             (bare relative — contains '/' and no whitespace)
 *
 * Rejects multi-line strings, bare filenames (no '/'), whitespace-containing
 * strings, and anything longer than 1 KB.
 */
export function looksLikePath(s: string): boolean {
  if (!s || s.length > 1024) {
    return false;
  }
  if (/[\n\r]/.test(s)) {
    return false;
  }
  // Explicit prefix forms
  if (s.startsWith('/') || s.startsWith('~/') || s === '~' || s.startsWith('./') || s.startsWith('../')) {
    return true;
  }
  // Bare relative path (e.g. VS Code ‘Copy Relative Path’ without a ./ prefix):
  // must contain at least one '/' and no whitespace.
  return s.includes('/') && !/\s/.test(s);
}

// JXA snippet that reads the first file URI from the VS Code "code/file-list" pasteboard type.
// Throws if the type is absent so that execText rejects and the caller can fall through.
const VSCODE_FILE_LIST_JXA = ["ObjC.import('AppKit');", 'var pb = $.NSPasteboard.generalPasteboard;', "var d = pb.dataForType($('code/file-list'));", "if (!d || !d.length) throw 'no code/file-list data';", '$.NSString.alloc.initWithDataEncoding(d, $.NSUTF8StringEncoding).js'].join(' ');

/**
 * Read a file path from VS Code's proprietary "code/file-list" pasteboard type.
 *
 * VS Code places a `file://` URI (or newline-separated list for multi-select) on
 * the clipboard when you right-click a file in the Explorer and choose Copy.
 * Neither `pbpaste` nor the AppleScript `furl` type can see it.
 *
 * Returns the POSIX path of the first file, or null if the type is absent / undecodable.
 */
async function readVSCodeFileList(): Promise<string | null> {
  const raw = await execText('osascript', ['-l', 'JavaScript', '-e', VSCODE_FILE_LIST_JXA]);
  if (!raw) {
    return null;
  }
  // code/file-list may contain multiple file: URIs (one per line); take the first.
  const firstUri = raw
    .trim()
    .split(/[\r\n]/)[0]
    .trim();
  if (!firstUri) {
    return null;
  }
  try {
    return fileURLToPath(firstUri);
  } catch {
    return null;
  }
}

/**
 * Core two-stage path resolution logic, with injectable callables for testing.
 *
 * Stage 1 (`pbpaste`): plain-text clipboard, accepted only if it `looksLikePath`.
 * Stages 2+ (`fileProbes`): file-format–specific probes tried in order; the
 *   first non-null result wins. Errors are caught and treated as "no result".
 *
 * Returns null if no stage yields a path.
 */
export async function readClipboardPathCore(pbpaste: () => Promise<string | null>, ...fileProbes: Array<() => Promise<string | null>>): Promise<string | null> {
  const text = await pbpaste().catch(() => null);
  const trimmed = text?.trim() ?? null;
  const pathLike = trimmed !== null && looksLikePath(trimmed);
  logger.trace('clipboard: pbpaste looksLikePath', { trimmed, accepted: pathLike });
  if (pathLike && trimmed) {
    return trimmed;
  }
  for (const probe of fileProbes) {
    const path = await probe().catch(() => null);
    if (path) {
      return path;
    }
  }
  return null;
}

/**
 * Wrap a probe function with trace-level logging.
 * On success the raw result is logged before being returned.
 * On failure the error is logged and re-thrown so readClipboardPathCore can
 * catch it and continue to the next probe.
 */
function logged(label: string, fn: () => Promise<string | null>): () => Promise<string | null> {
  return async () => {
    try {
      const result = await fn();
      logger.trace(`clipboard: ${label}`, { result });
      return result;
    } catch (err) {
      logger.trace(`clipboard: ${label} failed`, { error: String(err) });
      throw err;
    }
  };
}

/**
 * Return null if `path` looks like an HFS artifact from AppleScript coercing
 * plain text as a file reference.
 *
 * When the clipboard contains plain text (e.g. a bare relative path like
 * `apps/foo/bar.ts`) and `the clipboard as «class furl»` is evaluated,
 * AppleScript treats `/` in the text as the HFS path separator `:`, producing
 * a path like `/apps:foo:bar.ts`. A genuine `POSIX path of` result from a real
 * file reference always uses `/` as separator and never contains `:`.
 */
export function sanitiseFurlResult(path: string | null): string | null {
  if (!path || path.includes(':')) {
    return null;
  }
  return path;
}

/**
 * Read a file path from the osascript `furl` clipboard type.
 * Rejects results that contain `:` (HFS artifacts from plain-text coercion).
 */
async function readOsascriptFurl(): Promise<string | null> {
  const raw = await execText('osascript', ['-e', 'POSIX path of (the clipboard as «class furl»)']);
  const sanitised = sanitiseFurlResult(raw);
  if (raw !== null && sanitised === null) {
    logger.trace('clipboard: osascript:furl rejecting HFS artifact', { raw });
  }
  return sanitised;
}

/**
 * Read a file path from the clipboard.
 *
 * Three-stage:
 * 1. pbpaste         — if the plain-text content looks like a path, use it.
 *                      (Terminal copy, VS Code “Copy Path” / “Copy Relative Path”.)
 * 2. code/file-list  — VS Code Explorer “Copy”; contains a file:// URI.
 * 3. osascript furl  — Finder ⌘C; pbpaste only gives the bare filename.
 *                      HFS artifacts (colons) are rejected.
 *
 * Returns null if no stage yields a path.
 */
export async function readClipboardPath(): Promise<string | null> {
  const result = await readClipboardPathCore(
    logged('pbpaste', () => execText('pbpaste', [])),
    logged('vscode:code/file-list', () => readVSCodeFileList()),
    logged('osascript:furl', readOsascriptFurl),
  );
  logger.trace('clipboard: readClipboardPath', { result });
  return result;
}

// ---------------------------------------------------------------------------
// Image clipboard
// ---------------------------------------------------------------------------

export type ImageReader = () => Promise<Buffer | null>;

export type ClipboardImageResult = { kind: 'image'; data: Buffer } | { kind: 'empty' } | { kind: 'unsupported' };

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/**
 * Core image clipboard reader with injectable callables for testing.
 *
 * Tries each reader in order. First one to return a non-null Buffer wins.
 * All null means empty. No readers means unsupported.
 */
export async function readClipboardImageCore(...readers: ImageReader[]): Promise<ClipboardImageResult> {
  if (readers.length === 0) {
    return { kind: 'unsupported' };
  }
  for (const reader of readers) {
    const data = await reader();
    if (data !== null) {
      return { kind: 'image', data };
    }
  }
  return { kind: 'empty' };
}

/**
 * Detect image media type from magic bytes.
 *
 * Supports PNG, JPEG, GIF (87a/89a), and WebP.
 * Returns null for unrecognised formats or buffers too short to identify.
 */
export function detectMediaType(data: Buffer): ImageMediaType | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length >= 6) {
    const header = data.toString('ascii', 0, 6);
    if (header === 'GIF87a' || header === 'GIF89a') {
      return 'image/gif';
    }
  }
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/**
 * Read an image from the system clipboard (macOS only).
 *
 * Uses `pngpaste -` to read raw PNG bytes from the clipboard.
 * Returns `unsupported` if no readers are available, `empty` if the
 * clipboard has no image, or `image` with the raw bytes on success.
 */
export async function readClipboardImage(): Promise<ClipboardImageResult> {
  return readClipboardImageCore(() => execBuffer('pngpaste', ['-']));
}
