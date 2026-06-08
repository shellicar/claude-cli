import { INVERSE_OFF, INVERSE_ON } from '@shellicar/claude-core/ansi';
import { wrapLine } from '@shellicar/claude-core/reflow';
import type { EditorState } from '../model/EditorState.js';

/**
 * Render the editor text content for the current state.
 *
 * Returns one wrapped line per visual row — no divider, no blank padding.
 * The caller (AppLayout / ScreenCoordinator) is responsible for placing
 * the section header above this output, consistent with every other block.
 *
 * The cursor character is wrapped in INVERSE_ON / INVERSE_OFF so it renders
 * as a block cursor without displacing any text. At EOL, a space is used as
 * the cursor target.
 */

const PROMPT_PREFIX = '💬 ';
const INDENT = '   ';

export function renderEditor(state: EditorState, cols: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < state.lines.length; i++) {
    const pfx = i === 0 ? PROMPT_PREFIX : INDENT;
    const line = state.lines[i] ?? '';
    if (i === state.cursorLine) {
      // Use a segmenter to read the full grapheme cluster under the cursor
      // rather than a single code unit. This prevents lone surrogates when the
      // cursor rests on a 2-code-unit emoji (e.g. 🎉).
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const segs = [...seg.segment(line)];
      const grapheme = segs.find((s) => s.index === state.cursorCol);
      const charUnder = grapheme?.segment ?? ' ';
      const withCursor = `${line.slice(0, state.cursorCol)}${INVERSE_ON}${charUnder}${INVERSE_OFF}${line.slice(state.cursorCol + charUnder.length)}`;
      out.push(...wrapLine(pfx + withCursor, cols));
    } else {
      out.push(...wrapLine(pfx + line, cols));
    }
  }
  return out;
}
