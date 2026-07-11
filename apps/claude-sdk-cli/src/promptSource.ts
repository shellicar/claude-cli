import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';

/**
 * Reads a prompt-source file, trimmed. Returns null when the file is absent
 * or empty, so callers treat "not there" and "there but blank" the same way.
 */
export async function readIfPresent(fs: IFileSystem, path: string): Promise<string | null> {
  try {
    const content = (await fs.readFile(path)).trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/**
 * Frames injected content as a named XML-like block: the tag on its own lines,
 * a header as the first inner line, then a blank line, then the body. This is
 * the shared shape every CLAUDE.md / SYSTEM.md source is wrapped in, so the
 * format lives in one place and cannot drift between injectors.
 */
export function wrapBlock(tag: string, header: string, body: string): string {
  return `<${tag}>\n${header}\n\n${body}\n</${tag}>`;
}
