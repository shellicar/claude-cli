import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { pathSchema } from '@shellicar/claude-sdk';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { applyEdits } from '../../EditFile/applyEdits.js';
import { generateDiff } from '../../EditFile/generateDiff.js';
import { resolveAfterLine } from '../../EditFile/resolveAfterLine.js';
import { EditFileLineOperationSchema, EditFileTextOperationSchema } from '../../EditFile/schema.js';
import type { EditFileLineOperationType, EditFileTextOperationType } from '../../EditFile/types.js';
import { validateLineEdits } from '../../EditFile/validateEdits.js';
import { defineToolV2 } from '../defineToolV2.js';

function lineKey(total: number, edit: EditFileLineOperationType): number {
  return edit.action === 'insert' ? resolveAfterLine(edit.after_line, total) : edit.startLine;
}

function sortBottomToTop(total: number, edits: EditFileLineOperationType[]): EditFileLineOperationType[] {
  return [...edits].sort((a, b) => lineKey(total, b) - lineKey(total, a));
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

function applyReplaceText(content: string, edit: Extract<EditFileTextOperationType, { action: 'replace_text' }>, index: number): string {
  const count = countOccurrences(content, edit.oldString);
  if (count === 0) {
    throw new Error(`textEdits[${index}] replace_text: "${edit.oldString}" not found in file`);
  }
  if (count > 1 && !edit.replaceMultiple) {
    throw new Error(`textEdits[${index}] replace_text: "${edit.oldString}" matched ${count} times \u2014 set replaceMultiple: true to replace all`);
  }
  if (edit.replaceMultiple) {
    return content.split(edit.oldString).join(edit.replacement);
  }
  const at = content.indexOf(edit.oldString);
  return content.slice(0, at) + edit.replacement + content.slice(at + edit.oldString.length);
}

function applyRegexText(content: string, edit: Extract<EditFileTextOperationType, { action: 'regex_text' }>, index: number): string {
  const matches = [...content.matchAll(new RegExp(edit.pattern, 'g'))];
  if (matches.length === 0) {
    throw new Error(`textEdits[${index}] regex_text: pattern "${edit.pattern}" not found in file`);
  }
  if (matches.length > 1 && !edit.replaceMultiple) {
    throw new Error(`textEdits[${index}] regex_text: pattern "${edit.pattern}" matched ${matches.length} times \u2014 set replaceMultiple: true to replace all`);
  }
  return content.replace(new RegExp(edit.pattern, edit.replaceMultiple ? 'g' : ''), edit.replacement);
}

function applyTextEdits(content: string, edits: EditFileTextOperationType[]): string {
  let current = content;
  edits.forEach((edit, index) => {
    current = edit.action === 'replace_text' ? applyReplaceText(current, edit, index) : applyRegexText(current, edit, index);
  });
  return current;
}

export const EditFileToolV2Model = z
  .object({
    file: pathSchema,
    lineEdits: z
      .array(EditFileLineOperationSchema)
      .optional()
      .default([])
      .describe('Structural edits by line number (insert / replace / delete). Applied bottom-to-top so all line numbers refer to the file as it exists before this call \u2014 no offset calculation needed. If two edits target the same lines, an error is thrown.'),
    textEdits: z.array(EditFileTextOperationSchema).optional().default([]).describe('Text-search edits (replace_text / regex_text). Applied in order after all lineEdits.'),
  })
  .refine((input) => input.lineEdits.length > 0 || input.textEdits.length > 0, {
    message: 'At least one edit must be provided (lineEdits or textEdits)',
  });

/** The V2 tool equivalent of V1's `EditFile` \u2014 identical logic, reusing the same
 *  `applyEdits`/`generateDiff`/`resolveAfterLine`/`validateLineEdits` modules verbatim (pure,
 *  file-agnostic functions, nothing V1-specific about them). The only real difference is the
 *  output shape: V1 returns the diff as one JSON string; V2 splits it into lines, the same
 *  plain-text convention every V2 tool follows, so a huge diff can still be piped into
 *  Head/Tail/Range/Match like any other tool's output. A thrown validation error (out of
 *  bounds, overlapping edits, a replace_text not found) propagates as a stream rejection,
 *  same as `Program`'s own failsafe termination \u2014 no separate error channel needed. */
export function createEditFileToolV2(fs: IFileSystem) {
  return defineToolV2({
    name: 'EditFile',
    description: 'Edit a file: apply line and text edits, write the result to disk, and return a line-numbered diff.',
    operation: 'fs.write',
    model: EditFileToolV2Model,
    run: (input): ToolV2Result<string> => {
      async function* run(): Stream<string> {
        const baseContent = await fs.readFile(input.file);
        // ''.split('\n') yields [''] — one phantom line, not zero — which would make an empty
        // file resolve after_line against a 1-line file instead of a 0-line one.
        const baseLines = baseContent === '' ? [] : baseContent.split('\n');
        const sorted = sortBottomToTop(baseLines.length, input.lineEdits);
        validateLineEdits(baseLines, sorted);
        const afterLineEdits = applyEdits(baseLines, sorted);
        const newContent = applyTextEdits(afterLineEdits.join('\n'), input.textEdits);
        const diff = generateDiff(baseContent, newContent);
        await fs.writeFile(input.file, newContent);
        for (const line of diff.split('\n')) {
          yield line;
        }
      }

      return { stdout: run(), success: () => true };
    },
  });
}
