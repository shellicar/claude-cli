import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { applyEdits } from './applyEdits';
import { applyTextEdits, sortBottomToTop } from './applyTextEdits';
import { generateDiff } from './generateDiff';
import type { EditFileLineOperationType, EditFileTextOperationType } from './types';
import { validateLineEdits } from './validateEdits';

/** The whole EditFile operation \u2014 read, sort bottom-to-top, validate, apply line edits, apply
 *  text edits, diff, write \u2014 shared verbatim between V1 and V2. Neither wraps anything
 *  file-format- or tool-shape-specific around this; only how the returned diff string is
 *  packaged (V1: one JSON string; V2: split into lines) differs at the call site. */
export async function performEdit(fs: IFileSystem, file: string, lineEdits: EditFileLineOperationType[], textEdits: EditFileTextOperationType[]): Promise<string> {
  const baseContent = await fs.readFile(file);
  // ''.split('\n') yields [''] — one phantom line, not zero — which would make an empty file
  // resolve after_line against a 1-line file instead of a 0-line one.
  const baseLines = baseContent === '' ? [] : baseContent.split('\n');
  const sorted = sortBottomToTop(baseLines.length, lineEdits);
  validateLineEdits(baseLines, sorted);
  const afterLineEdits = applyEdits(baseLines, sorted);
  const newContent = applyTextEdits(afterLineEdits.join('\n'), textEdits);
  const diff = generateDiff(baseContent, newContent);
  await fs.writeFile(file, newContent);
  return diff;
}
