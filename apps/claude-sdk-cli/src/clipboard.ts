import { execFile } from 'node:child_process';

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

/**
 * Core two-stage path resolution logic, with injectable callables for testing.
 *
 * Stage 1: call `pbpaste()` — if the result looks like a path, return it.
 * Stage 2: call `osascript()` — used when Finder ⌘C puts a furl on the
 *          clipboard and pbpaste only returns a bare filename or empty string.
 *
 * Returns null if neither stage yields a path.
 */
export async function readClipboardPathCore(pbpaste: () => Promise<string | null>, osascript: () => Promise<string | null>): Promise<string | null> {
  const text = await pbpaste().catch(() => null);
  if (text && looksLikePath(text.trim())) {
    return text.trim();
  }
  return osascript().catch(() => null);
}

/**
 * Read a file path from the clipboard.
 *
 * Two-stage:
 * 1. pbpaste  — if the plain-text content looks like an absolute path, use it.
 *              (Handles paths copied from a terminal or VS Code "Copy Path".)
 * 2. osascript — extract the POSIX path from a Finder file reference
 *              (i.e. a file copied with ⌘C in Finder, where pbpaste only gives the filename).
 *
 * Returns null if neither stage yields a path.
 */
export async function readClipboardPath(): Promise<string | null> {
  return readClipboardPathCore(
    () => execText('pbpaste', []),
    () => execText('osascript', ['-e', 'POSIX path of (the clipboard as \u00abclass furl\u00bb)']),
  );
}
