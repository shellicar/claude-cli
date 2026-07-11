import { describe, expect, it } from 'vitest';
import { composeSystemPrompts } from '../src/composeSystemPrompts.js';

describe('composeSystemPrompts', () => {
  it('orders file sections, then config text, then flag text', () => {
    const expected = ['file-a', 'file-b', 'config', '<system-md>\nContents of the --system launch flag:\n\nflag\n</system-md>'];
    const actual = composeSystemPrompts({ fileSections: ['file-a', 'file-b'], configText: 'config', flagText: 'flag' });
    expect(actual).toEqual(expected);
  });

  it('wraps the flag text in a <system-md> tag', () => {
    const expected = '<system-md>\nContents of the --system launch flag:\n\nflag\n</system-md>';
    const actual = composeSystemPrompts({ fileSections: [], configText: null, flagText: 'flag' });
    expect(actual).toEqual([expected]);
  });

  it('omits config text when null', () => {
    const expected = ['file-a', '<system-md>\nContents of the --system launch flag:\n\nflag\n</system-md>'];
    const actual = composeSystemPrompts({ fileSections: ['file-a'], configText: null, flagText: 'flag' });
    expect(actual).toEqual(expected);
  });

  it('omits flag text when null', () => {
    const expected = ['file-a', 'config'];
    const actual = composeSystemPrompts({ fileSections: ['file-a'], configText: 'config', flagText: null });
    expect(actual).toEqual(expected);
  });

  it('omits config and flag when both null', () => {
    const expected = ['file-a'];
    const actual = composeSystemPrompts({ fileSections: ['file-a'], configText: null, flagText: null });
    expect(actual).toEqual(expected);
  });

  it('returns an empty array when all inputs are empty', () => {
    const expected: string[] = [];
    const actual = composeSystemPrompts({ fileSections: [], configText: null, flagText: null });
    expect(actual).toEqual(expected);
  });

  it('omits config text when it is the empty string', () => {
    const expected = ['file-a'];
    const actual = composeSystemPrompts({ fileSections: ['file-a'], configText: '', flagText: null });
    expect(actual).toEqual(expected);
  });
});
