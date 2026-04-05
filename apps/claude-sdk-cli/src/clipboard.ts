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

/** Read plain text from the system clipboard. Returns null if empty or unavailable. */
export async function readClipboardText(): Promise<string | null> {
  return execText('pbpaste', []);
}

/**
 * Return true if the string looks like an absolute, home-relative, or
 * explicitly-relative filesystem path.
 *
 * Accepts:
 *   /absolute/path
 *   ~/home/relative
 *   ./explicitly/relative
 *   ../parent/relative
 *
 * Rejects multi-line strings, bare filenames, and anything longer than 1 KB.
 */
export function looksLikePath(s: string): boolean {
  if (!s || s.length > 1024) {
    return false;
  }
  if (/[\n\r]/.test(s)) {
    return false;
  }
  return s.startsWith('/') || s.startsWith('~/') || s === '~' || s.startsWith('./') || s.startsWith('../');
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
 * Read a file path from the clipboard.
 *
 * Three-stage:
 * 1. pbpaste     — if the plain-text content looks like a path, use it.
 *                  (Terminal copy, VS Code "Copy Path" / "Copy Relative Path".)
 * 2. code/file-list — VS Code "Copy" in the Explorer; contains a file:// URI.
 * 3. osascript furl — Finder ⌘C; pbpaste only gives the bare filename.
 *
 * Returns null if no stage yields a path.
 */
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

export async function readClipboardPath(): Promise<string | null> {
  const result = await readClipboardPathCore(
    logged('pbpaste', () => execText('pbpaste', [])),
    logged('vscode:code/file-list', () => readVSCodeFileList()),
    logged('osascript:furl', () => execText('osascript', ['-e', 'POSIX path of (the clipboard as \u00abclass furl\u00bb)'])),
  );
  logger.trace('clipboard: readClipboardPath', { result });
  return result;
}
