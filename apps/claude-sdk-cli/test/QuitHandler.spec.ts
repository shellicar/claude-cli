import { describe, expect, it } from 'vitest';
import { QuitHandler } from '../src/controller/QuitHandler.js';

describe('QuitHandler', () => {
  it('requests the shutdown coordinator on ctrl+c, never exiting directly', () => {
    let requested = false;
    const handler = new QuitHandler(() => {
      requested = true;
    });
    handler.handleKey({ type: 'ctrl+c' });
    const expected = true;
    const actual = requested;
    expect(actual).toBe(expected);
  });

  it('passes through a non-quit key', () => {
    const handler = new QuitHandler(() => {});
    const expected = false;
    const actual = handler.handleKey({ type: 'escape' });
    expect(actual).toBe(expected);
  });
});
