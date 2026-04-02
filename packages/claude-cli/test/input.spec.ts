import { describe, expect, it } from 'vitest';
import { type NodeKey, translateKey } from '../src/input.js';

function key(name: string, opts: Partial<NodeKey> = {}): NodeKey {
  return { sequence: '', name, ctrl: false, meta: false, shift: false, ...opts };
}

describe('translateKey', () => {
  it('pageup produces page_up', () => {
    expect(translateKey(undefined, key('pageup'))).toEqual({ type: 'page_up' });
  });

  it('pagedown produces page_down', () => {
    expect(translateKey(undefined, key('pagedown'))).toEqual({ type: 'page_down' });
  });

  it('shift+up produces shift+up', () => {
    expect(translateKey(undefined, key('up', { shift: true }))).toEqual({ type: 'shift+up' });
  });

  it('shift+down produces shift+down', () => {
    expect(translateKey(undefined, key('down', { shift: true }))).toEqual({ type: 'shift+down' });
  });

  it('unmodified up still produces up', () => {
    expect(translateKey(undefined, key('up'))).toEqual({ type: 'up' });
  });

  it('unmodified down still produces down', () => {
    expect(translateKey(undefined, key('down'))).toEqual({ type: 'down' });
  });

  it('ctrl+up does not produce shift+up', () => {
    const result = translateKey(undefined, key('up', { ctrl: true }));
    expect(result?.type).not.toBe('shift+up');
  });
});
