import { describe, expect, it, vi } from 'vitest';
import { QuitHandler } from '../src/controller/QuitHandler.js';

describe('QuitHandler', () => {
  it('calls onExit on ctrl+c', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    let exited = false;
    const handler = new QuitHandler(() => {
      exited = true;
    });
    handler.handleKey({ type: 'ctrl+c' });
    exitSpy.mockRestore();
    const expected = true;
    const actual = exited;
    expect(actual).toBe(expected);
  });

  it('passes through a non-quit key', () => {
    const handler = new QuitHandler(() => {});
    const expected = false;
    const actual = handler.handleKey({ type: 'escape' });
    expect(actual).toBe(expected);
  });
});
