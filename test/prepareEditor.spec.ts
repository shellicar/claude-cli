import { describe, expect, it } from 'vitest';
import type { EditorState } from '../src/editor.js';
import { prepareEditor } from '../src/renderer.js';

// In test (non-TTY) environments process.stdout.columns is undefined,
// so renderer falls back to 80 columns via `|| 80`.
const COLUMNS = 80;
const PROMPT = '> '; // visual width 2

function editor(text: string, col?: number): EditorState {
  return { lines: [text], cursor: { row: 0, col: col ?? text.length } };
}

describe('prepareEditor', () => {
  describe('cursorCol is always within-row (< columns), not the absolute offset', () => {
    it('cursor at exact wrap boundary wraps cursorCol to 0', () => {
      // prompt(2) + text(78) = 80 = COLUMNS: cursor is at the start of visual row 1
      const result = prepareEditor(editor('a'.repeat(78)), PROMPT);
      expect(result.cursorRow).toBe(1);
      expect(result.cursorCol).toBe(0);
    });

    it('cursor past wrap boundary gives correct within-row offset', () => {
      // prompt(2) + text(83) = 85: visual row 1, column 5
      const result = prepareEditor(editor('a'.repeat(83)), PROMPT);
      expect(result.cursorRow).toBe(1);
      expect(result.cursorCol).toBe(5);
    });

    it('cursor before any wrap is unchanged', () => {
      // prompt(2) + text(10) = 12, stays on row 0
      const result = prepareEditor(editor('a'.repeat(10)), PROMPT);
      expect(result.cursorRow).toBe(0);
      expect(result.cursorCol).toBe(12);
    });

    it('cursorCol is always less than terminal width for all wrap positions', () => {
      for (const len of [77, 78, 79, 80, 81, 158, 159, 160, 161]) {
        const result = prepareEditor(editor('a'.repeat(len)), PROMPT);
        expect(result.cursorCol, `len=${len}`).toBeLessThan(COLUMNS);
      }
    });
  });
});
