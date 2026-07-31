import { describe, expect, it } from 'vitest';
import { FrameReader } from '../src/typescript/FrameReader.js';

/** A frame exactly as tsserver writes one: the length counts bytes, not characters. */
function frame(payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'utf8'), body]);
}

describe('reading tsserver frames', () => {
  it('reads a message whose body is plain ASCII', () => {
    const reader = new FrameReader();

    const expected = [{ seq: 1, body: 'plain' }];
    const actual = reader.push(frame({ seq: 1, body: 'plain' }));
    expect(actual).toEqual(expected);
  });

  // A hover answer carries the symbol's own documentation, so any non-ASCII a codebase writes in a
  // comment ends up here. An em dash is one character and three bytes.
  it('reads a message whose body contains a multi-byte character', () => {
    const reader = new FrameReader();

    const expected = [{ seq: 2, body: 'a — b' }];
    const actual = reader.push(frame({ seq: 2, body: 'a — b' }));
    expect(actual).toEqual(expected);
  });

  it('reads the message following a multi-byte one, rather than losing the boundary', () => {
    const reader = new FrameReader();

    const expected = [
      { seq: 3, body: '— first' },
      { seq: 4, body: 'second' },
    ];
    const actual = reader.push(Buffer.concat([frame({ seq: 3, body: '— first' }), frame({ seq: 4, body: 'second' })]));
    expect(actual).toEqual(expected);
  });

  it('waits for the rest of a message split across chunks', () => {
    const reader = new FrameReader();
    const whole = frame({ seq: 5, body: 'split — here' });

    reader.push(whole.subarray(0, 20));
    const expected = [{ seq: 5, body: 'split — here' }];
    const actual = reader.push(whole.subarray(20));
    expect(actual).toEqual(expected);
  });

  it('yields nothing until a message is complete', () => {
    const reader = new FrameReader();
    const whole = frame({ seq: 6, body: 'incomplete' });

    const expected: unknown[] = [];
    const actual = reader.push(whole.subarray(0, whole.byteLength - 5));
    expect(actual).toEqual(expected);
  });
});
