import { diffLines } from 'diff';

const CONTEXT = 3;

type DiffEntry = { kind: 'ctx' | 'add' | 'del'; num: number; text: string };

function splitLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop(); // diffLines keeps the trailing newline as an empty final element
  }
  return lines;
}

function renderEntry(entry: DiffEntry): string {
  const prefix = entry.kind === 'add' ? '+' : entry.kind === 'del' ? '-' : ' ';
  return `${prefix}${entry.num}:${entry.text}`;
}

// Collapses runs of unchanged context beyond `CONTEXT` lines from the nearest change into a single
// '…' marker, unified-diff style, so an edit deep in a large file doesn't dump the whole file back.
function trimContext(entries: DiffEntry[]): string[] {
  const keep = new Array(entries.length).fill(false);
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]?.kind !== 'ctx') {
      for (let j = Math.max(0, i - CONTEXT); j <= Math.min(entries.length - 1, i + CONTEXT); j++) {
        keep[j] = true;
      }
    }
  }
  const out: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry == null) {
      continue;
    }
    if (keep[i]) {
      out.push(renderEntry(entry));
    } else if (keep[i - 1]) {
      out.push('…');
    }
  }
  return out;
}

/**
 * Renders a diff as plain text, one line per source line, numbered against the resulting
 * (new) file's line numbers for changed/context lines and the original file's for removed
 * lines — so a caller can read a changed line's number straight off the output and use it
 * in a follow-up edit, the same way Read/Match number lines.
 */
export function generateDiff(originalContent: string, newContent: string): string {
  const parts = diffLines(originalContent, newContent);
  const entries: DiffEntry[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const part of parts) {
    const lines = splitLines(part.value);
    if (part.added) {
      for (const text of lines) {
        entries.push({ kind: 'add', num: newLine, text });
        newLine++;
      }
    } else if (part.removed) {
      for (const text of lines) {
        entries.push({ kind: 'del', num: oldLine, text });
        oldLine++;
      }
    } else {
      for (const text of lines) {
        entries.push({ kind: 'ctx', num: newLine, text });
        oldLine++;
        newLine++;
      }
    }
  }
  return trimContext(entries).join('\n');
}
