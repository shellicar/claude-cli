import { describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../src/fs/NodeFileSystem';

describe('NodeFileSystem', () => {
  const fs = new NodeFileSystem();

  describe('platform', () => {
    it('returns the real process platform', () => {
      const expected = process.platform;
      const actual = fs.platform();
      expect(actual).toBe(expected);
    });
  });

  describe('arch', () => {
    it('returns the real process arch', () => {
      const expected = process.arch;
      const actual = fs.arch();
      expect(actual).toBe(expected);
    });
  });
});
