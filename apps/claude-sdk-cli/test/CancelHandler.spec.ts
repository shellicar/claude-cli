import { describe, expect, it } from 'vitest';
import { CancelHandler } from '../src/controller/CancelHandler.js';

describe('CancelHandler', () => {
  it('invokes onCancel on escape', () => {
    let cancelled = false;
    const handler = new CancelHandler(() => {
      cancelled = true;
    });
    handler.handleKey({ type: 'escape' });
    const expected = true;
    const actual = cancelled;
    expect(actual).toBe(expected);
  });

  it('claims the escape key', () => {
    const handler = new CancelHandler(() => {});
    const expected = true;
    const actual = handler.handleKey({ type: 'escape' });
    expect(actual).toBe(expected);
  });

  it('passes through a non-escape key', () => {
    const handler = new CancelHandler(() => {});
    const expected = false;
    const actual = handler.handleKey({ type: 'char', value: 'x' });
    expect(actual).toBe(expected);
  });
});
