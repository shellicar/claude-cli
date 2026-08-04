import { describe, expect, it } from 'vitest';
import type { IEditorBuffer } from '../src/model/EditorBuffer.js';
import { buildEditorBuffer } from './buildEditorBuffer.js';

const key = (type: string, value = '') => ({ type, value }) as Parameters<IEditorBuffer['handleKey']>[0];
const char = (value: string) => key('char', value);

describe('EditorBuffer — reset', () => {
  it('clears lines back to one empty line', () => {
    const buffer = buildEditorBuffer();
    buffer.handleKey(char('hello'));
    buffer.reset();
    const expected = 1;
    const actual = buffer.content.lines.length;
    expect(actual).toBe(expected);
  });

  it('resets cursor line to 0', () => {
    const buffer = buildEditorBuffer();
    buffer.handleKey(char('hello'));
    buffer.handleKey(key('enter'));
    buffer.reset();
    const expected = 0;
    const actual = buffer.content.cursorLine;
    expect(actual).toBe(expected);
  });

  it('resets cursor col to 0', () => {
    const buffer = buildEditorBuffer();
    buffer.handleKey(char('hello'));
    buffer.reset();
    const expected = 0;
    const actual = buffer.content.cursorCol;
    expect(actual).toBe(expected);
  });

  it('clears a content reference taken before the reset', () => {
    const buffer = buildEditorBuffer();
    buffer.handleKey(char('hello'));
    const held = buffer.content;
    buffer.reset();
    const expected = '';
    const actual = held.lines[0];
    expect(actual).toBe(expected);
  });
});

describe('EditorBuffer — change event', () => {
  it('emits when a key is consumed', () => {
    const buffer = buildEditorBuffer();
    let count = 0;
    buffer.on('change', () => {
      count++;
    });
    buffer.handleKey(char('a'));
    const expected = 1;
    const actual = count;
    expect(actual).toBe(expected);
  });

  it('does not emit when a key is not consumed', () => {
    const buffer = buildEditorBuffer();
    let count = 0;
    buffer.on('change', () => {
      count++;
    });
    buffer.handleKey(key('ctrl+enter'));
    const expected = 0;
    const actual = count;
    expect(actual).toBe(expected);
  });

  it('stops emitting to a removed listener', () => {
    const buffer = buildEditorBuffer();
    let count = 0;
    const listener = () => {
      count++;
    };
    buffer.on('change', listener);
    buffer.off('change', listener);
    buffer.handleKey(char('a'));
    const expected = 0;
    const actual = count;
    expect(actual).toBe(expected);
  });
});

describe('EditorBuffer — setText', () => {
  it('replaces the content with the given text', () => {
    const expected = ['think about pineapples'];
    const buffer = buildEditorBuffer();
    buffer.handleKey(char('leftover'));
    buffer.setText('think about pineapples');
    const actual = [...buffer.content.lines];
    expect(actual).toEqual(expected);
  });

  it('splits a multi-line text across lines', () => {
    const expected = ['first', 'second'];
    const buffer = buildEditorBuffer();
    buffer.setText('first\nsecond');
    const actual = [...buffer.content.lines];
    expect(actual).toEqual(expected);
  });

  it('leaves the cursor on the last line', () => {
    const expected = 1;
    const buffer = buildEditorBuffer();
    buffer.setText('first\nsecond');
    const actual = buffer.content.cursorLine;
    expect(actual).toBe(expected);
  });

  it('leaves the cursor at the end of the last line', () => {
    const expected = 6;
    const buffer = buildEditorBuffer();
    buffer.setText('first\nsecond');
    const actual = buffer.content.cursorCol;
    expect(actual).toBe(expected);
  });

  it('updates a content reference taken before the call', () => {
    const expected = 'restored';
    const buffer = buildEditorBuffer();
    const held = buffer.content;
    buffer.setText('restored');
    const actual = held.lines[0];
    expect(actual).toBe(expected);
  });

  it('emits a change', () => {
    const expected = 1;
    const buffer = buildEditorBuffer();
    let count = 0;
    buffer.on('change', () => {
      count++;
    });
    buffer.setText('restored');
    const actual = count;
    expect(actual).toBe(expected);
  });
});
