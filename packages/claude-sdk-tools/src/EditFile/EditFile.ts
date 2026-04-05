import { createHash, randomUUID } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import { defineTool } from '@shellicar/claude-sdk';
import { expandPath } from '../expandPath';
import type { IFileSystem } from '../fs/IFileSystem';
import { applyEdits } from './applyEdits';
import { generateDiff } from './generateDiff';
import { PreviewEditInputSchema, PreviewEditOutputSchema } from './schema';
import type { EditOperationType, PreviewEditOutputType, ResolvedEditOperationType } from './types';
import { validateEdits } from './validateEdits';

/**
 * Given two versions of a file split into lines, return a minimal set of
 * line-based operations (replace / delete / insert) that transforms the
 * original into the new content.  The algorithm finds the longest common
 * prefix and suffix and emits a single operation for the changed middle
 * region, which is sufficient for all replace_text use-cases.
 */
function findChangedRegions(originalLines: string[], newLines: string[]): ResolvedEditOperationType[] {
  if (originalLines.join('\n') === newLines.join('\n')) { return []; }

  let start = 0;
  while (start < originalLines.length && start < newLines.length && originalLines[start] === newLines[start]) {
    start++;
  }

  let endOrig = originalLines.length - 1;
  let endNew = newLines.length - 1;
  while (endOrig > start && endNew > start && originalLines[endOrig] === newLines[endNew]) {
    endOrig--;
    endNew--;
  }

  if (endOrig < start) {
    // Pure insertion between lines
    return [{ action: 'insert', after_line: start, content: newLines.slice(start, endNew + 1).join('\n') }];
  }
  if (endNew < start) {
    // Pure deletion
    return [{ action: 'delete', startLine: start + 1, endLine: endOrig + 1 }];
  }
  // Replace (covers single-line changes, line-count-changing replacements, etc.)
  return [{ action: 'replace', startLine: start + 1, endLine: endOrig + 1, content: newLines.slice(start, endNew + 1).join('\n') }];
}

/**
 * Convert an absolute file path to a display-friendly path relative to cwd
 * when it falls under the current working directory, otherwise return as-is.
 * This avoids the double-slash issue when passing absolute paths to
 * `createTwoFilesPatch` which prepends "a/" and "b/".
 */
function toDisplayPath(absolutePath: string): string {
  const cwd = process.cwd();
  const resolved = resolve(absolutePath);
  if (resolved === cwd || resolved.startsWith(cwd + sep)) {
    return relative(cwd, resolved);
  }
  return resolved;
}

/**
 * Resolve any `replace_text` operations in `edits` into equivalent
 * line-based operations.  All other operation types are passed through
 * unchanged.  Each replace_text edit is applied against the accumulated
 * result of all previous replace_text edits so that multiple ops on the
 * same file chain correctly.
 */
function resolveReplaceText(originalContent: string, edits: EditOperationType[]): ResolvedEditOperationType[] {
  const explicitOps: ResolvedEditOperationType[] = [];
  let currentContent = originalContent;

  for (const edit of edits) {
    if (edit.action !== 'replace_text' && edit.action !== 'regex_text') {
      explicitOps.push(edit);
      continue;
    }

    const pattern = edit.action === 'regex_text' ? edit.pattern : edit.oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const matches = [...currentContent.matchAll(new RegExp(pattern, 'g'))];

    if (matches.length === 0) {
      throw new Error(`replace_text: pattern "${pattern}" not found in file`);
    }
    if (matches.length > 1 && !edit.replaceMultiple) {
      throw new Error(`replace_text: pattern "${pattern}" matched ${matches.length} times — set replaceMultiple: true to replace all`);
    }

    currentContent = currentContent.replace(new RegExp(pattern, edit.replaceMultiple ? 'g' : ''), edit.replacement);
  }

  if (currentContent !== originalContent) {
    explicitOps.push(...findChangedRegions(originalContent.split('\n'), currentContent.split('\n')));
  }
  return explicitOps;
}

export function createPreviewEdit(fs: IFileSystem, store: Map<string, PreviewEditOutputType>) {
  return defineTool({
    name: 'PreviewEdit',
    description: 'Preview edits to a file. Returns a diff for review — does not write to disk.',
    operation: 'read',
    input_schema: PreviewEditInputSchema,
    input_examples: [
      {
        file: '/path/to/file.ts',
        edits: [{ action: 'insert', after_line: 0, content: '// hello world' }],
      },
      {
        file: '/path/to/file.ts',
        edits: [{ action: 'replace', startLine: 5, endLine: 7, content: 'const x = 1;' }],
      },
      {
        file: '/path/to/file.ts',
        edits: [{ action: 'delete', startLine: 10, endLine: 12 }],
      },
      {
        file: '/path/to/file.ts',
        edits: [
          { action: 'delete', startLine: 3, endLine: 3 },
          { action: 'replace', startLine: 8, endLine: 9, content: 'export default foo;' },
        ],
      },
      {
        file: '/path/to/file.ts',
        edits: [{ action: 'regex_text', pattern: 'import type \\{ (\\w+) \\}', replacement: 'import { $1 }' }],
      },
      {
        file: '/path/to/file.ts',
        edits: [{ action: 'replace_text', oldString: 'import type { MyClass }', replacement: 'import { MyClass }' }]
      }
    ],
    handler: async (input) => {
      const filePath = expandPath(input.file, fs);

      let baseContent: string;
      let originalHash: string;
      if (input.previousPatchId != null) {
        const prev = store.get(input.previousPatchId);
        if (!prev) { throw new Error('Previous patch not found. The patch store is in-memory — please run PreviewEdit again.'); }
        if (prev.file !== filePath) { throw new Error(`File mismatch: previousPatchId is for "${prev.file}" but this edit targets "${filePath}"`); }
        baseContent = prev.newContent;
        originalHash = prev.originalHash;
      } else {
        baseContent = await fs.readFile(filePath);
        originalHash = createHash('sha256').update(baseContent).digest('hex');
      }

      const baseLines = baseContent.split('\n');
      const resolvedEdits = resolveReplaceText(baseContent, input.edits);
      validateEdits(baseLines, resolvedEdits);
      const newLines = applyEdits(baseLines, resolvedEdits);
      const newContent = newLines.join('\n');
      const diff = generateDiff(toDisplayPath(filePath), baseContent, newContent);
      const output = PreviewEditOutputSchema.parse({
        patchId: randomUUID(),
        diff,
        file: filePath,
        newContent,
        originalHash,
      });
      store.set(output.patchId, output);
      return output;
    },
  });
}