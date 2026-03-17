import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../src/mcp/shellicar/exec/stripAnsi';

describe('stripAnsi', () => {
  it('strips SGR color codes', () => {
    expect(stripAnsi('\u001B[31mred\u001B[0m')).toBe('red');
  });

  it('strips bold/underline codes', () => {
    expect(stripAnsi('\u001B[1mbold\u001B[22m \u001B[4munderline\u001B[24m')).toBe('bold underline');
  });

  it('strips 256-color codes', () => {
    expect(stripAnsi('\u001B[38;5;196mred\u001B[0m')).toBe('red');
  });

  it('strips 24-bit RGB color codes', () => {
    expect(stripAnsi('\u001B[38;2;255;0;0mred\u001B[0m')).toBe('red');
  });

  it('strips cursor movement codes', () => {
    expect(stripAnsi('\u001B[2Aup\u001B[3Bdown')).toBe('updown');
  });

  it('strips erase line codes', () => {
    expect(stripAnsi('\u001B[2Kcleared')).toBe('cleared');
  });

  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('returns empty string unchanged', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('handles mixed ANSI and plain text', () => {
    // Simulating vitest-style output
    expect(stripAnsi('\u001B[32m✓\u001B[39m test passed \u001B[90m(5ms)\u001B[39m')).toBe('✓ test passed (5ms)');
  });

  it('handles multiple reset sequences', () => {
    expect(stripAnsi('\u001B[1m\u001B[31merror\u001B[39m\u001B[22m')).toBe('error');
  });
});
