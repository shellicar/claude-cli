import { describe, expect, it } from 'vitest';
import type { BuiltComponent, LayoutInput } from '../src/Layout.js';
import { layout } from '../src/Layout.js';

function makeEditor(lines: string[], cursorRow = 0, cursorCol = 0) {
  return { lines, cursorRow, cursorCol };
}

function component(rows: string[], height: number): BuiltComponent {
  return { rows, height };
}

describe('layout', () => {
  it('editor only: 5 single-row lines produce buffer of 5 rows', () => {
    const input: LayoutInput = {
      editor: makeEditor(['line 1', 'line 2', 'line 3', 'line 4', 'line 5']),
      status: null,
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    };
    const result = layout(input);
    expect(result.buffer.length).toBe(5);
    expect(result.editorStartRow).toBe(0);
    expect(result.cursorRow).toBe(0);
    expect(result.cursorCol).toBe(0);
  });

  it('status + editor: status row before editor, editorStartRow = 1', () => {
    const input: LayoutInput = {
      editor: makeEditor(['hello']),
      status: component(['status line'], 1),
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    };
    const result = layout(input);
    expect(result.buffer[0]).toBe('status line');
    expect(result.buffer[1]).toBe('hello');
    expect(result.editorStartRow).toBe(1);
    expect(result.cursorRow).toBe(1);
  });

  it('all components present: buffer order is question, status, attachment, preview, editor', () => {
    const input: LayoutInput = {
      editor: makeEditor(['editor']),
      status: component(['status'], 1),
      attachments: component(['attachment'], 1),
      preview: component(['preview'], 1),
      question: component(['question'], 1),
      columns: 80,
    };
    const result = layout(input);
    expect(result.buffer[0]).toBe('question');
    expect(result.buffer[1]).toBe('status');
    expect(result.buffer[2]).toBe('attachment');
    expect(result.buffer[3]).toBe('preview');
    expect(result.buffer[4]).toBe('editor');
    expect(result.editorStartRow).toBe(4);
    expect(result.cursorRow).toBe(4);
  });

  it('null components skipped: no empty rows in buffer', () => {
    const input: LayoutInput = {
      editor: makeEditor(['editor']),
      status: null,
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    };
    const result = layout(input);
    expect(result.buffer.length).toBe(1);
    expect(result.buffer[0]).toBe('editor');
  });

  it('long editor line wraps: 200 chars at 80 columns = 3 buffer rows', () => {
    const longLine = 'A'.repeat(200);
    const input: LayoutInput = {
      editor: makeEditor([longLine], 0, 0),
      status: null,
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    };
    const result = layout(input);
    expect(result.buffer.length).toBe(3);
    expect(result.buffer[0]).toBe('A'.repeat(80));
    expect(result.buffer[1]).toBe('A'.repeat(80));
    expect(result.buffer[2]).toBe('A'.repeat(40));
  });

  it('ZWJ sequence is decomposed: each emoji wraps independently', () => {
    // ZWJ sequences are stripped before layout so string-width matches terminal rendering.
    // 👨‍👩‍👦 (U+1F468 ZWJ U+1F469 ZWJ U+1F466) becomes 3 individual emojis, each width 2.
    // Total display width: A(1)+B(1)+man(2)+woman(2)+girl(2)+C(1) = 9, not 5.
    const familyEmoji = '\u{1F468}\u200D\u{1F469}\u200D\u{1F466}';
    const line = `AB${familyEmoji}C`;
    const input: LayoutInput = {
      editor: makeEditor([line], 0, 0),
      status: null,
      attachments: null,
      preview: null,
      question: null,
      columns: 4,
    };

    const result = layout(input);

    // Row 0: A(1)+B(1)+man(2) = 4. Row 1: woman(2)+girl(2) = 4. Row 2: C(1).
    expect(result.buffer).toHaveLength(3);
    expect(result.buffer[0]).toBe('AB\u{1F468}');
    expect(result.buffer[1]).toBe('\u{1F469}\u{1F466}');
    expect(result.buffer[2]).toBe('C');
  });

  it('50 editor lines: buffer has 50 rows, cursorRow accounts for non-editor rows', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const input: LayoutInput = {
      editor: makeEditor(lines, 25, 0),
      status: component(['status'], 1),
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    };
    const result = layout(input);
    expect(result.buffer.length).toBe(51); // 1 status + 50 editor
    expect(result.editorStartRow).toBe(1);
    expect(result.cursorRow).toBe(26); // 1 (status) + 25 (editor cursor)
  });

  it('cursorCol passes through from EditorRender.cursorCol', () => {
    const input: LayoutInput = {
      editor: makeEditor(['hello world'], 0, 5),
      status: null,
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    };
    const result = layout(input);
    expect(result.cursorCol).toBe(5);
  });

  it('editorStartRow correct with two non-editor components', () => {
    const input: LayoutInput = {
      editor: makeEditor(['e']),
      status: component(['s'], 1),
      attachments: component(['a'], 1),
      preview: null,
      question: null,
      columns: 80,
    };
    const result = layout(input);
    expect(result.editorStartRow).toBe(2);
  });

  it('editorStartRow correct with question and preview but no status or attachment', () => {
    const input: LayoutInput = {
      editor: makeEditor(['e']),
      status: null,
      attachments: null,
      preview: component(['p'], 1),
      question: component(['q'], 1),
      columns: 80,
    };
    const result = layout(input);
    expect(result.buffer[0]).toBe('q');
    expect(result.buffer[1]).toBe('p');
    expect(result.editorStartRow).toBe(2);
  });

  it('multi-row component contributes multiple buffer entries', () => {
    const input: LayoutInput = {
      editor: makeEditor(['e']),
      status: null,
      attachments: null,
      preview: component(['preview line 1', 'preview line 2', 'preview line 3'], 3),
      question: null,
      columns: 80,
    };
    const result = layout(input);
    expect(result.buffer[0]).toBe('preview line 1');
    expect(result.buffer[1]).toBe('preview line 2');
    expect(result.buffer[2]).toBe('preview line 3');
    expect(result.editorStartRow).toBe(3);
    expect(result.cursorRow).toBe(3);
  });

  it('ZWJ family emoji at col 79: wraps to next line (terminal renders 4 emojis x 2 = 8 cells)', () => {
    // string-width reports the ZWJ sequence as width 2 (composed form).
    // The terminal renders it as 4 separate emojis, each width 2 = 8 cells total.
    // 78 ASCII + 8 emoji cells = 86 > 80, so the emoji must wrap.
    // Without ZWJ stripping, layout sees 78+2=80 and returns 1 buffer row (wrong).
    const familyEmoji = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
    const line = 'A'.repeat(78) + familyEmoji;
    const input: LayoutInput = {
      editor: makeEditor([line], 0, 0),
      status: null,
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    };

    const result = layout(input);

    // 78 A's + first emoji (2 cols) = 80 on row 0; remaining 3 emojis on row 1.
    expect(result.buffer.length).toBe(2);
  });

  it('editor cursor on wrapped line: cursorRow offset by editorStartRow', () => {
    // Editor has 1 wrapped line (160 chars = 2 visual rows at 80 cols)
    // cursor is on visual row 1 of the editor (second wrap segment)
    // with 1 status row above, buffer cursorRow = 1 (status) + 1 (visual row) = 2
    const wrappedLine = 'B'.repeat(160);
    const input: LayoutInput = {
      editor: makeEditor([wrappedLine], 1, 10),
      status: component(['status'], 1),
      attachments: null,
      preview: null,
      question: null,
      columns: 80,
    };
    const result = layout(input);
    expect(result.buffer.length).toBe(3); // 1 status + 2 editor rows
    expect(result.editorStartRow).toBe(1);
    expect(result.cursorRow).toBe(2); // 1 + 1
    expect(result.cursorCol).toBe(10);
  });
});
