import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../src/fs/MemoryFileSystem';
import { expandPath } from '../src/expandPath';

describe('expandPath', () => {
  const fs = new MemoryFileSystem({}, '/home/test');

  describe('tilde expansion', () => {
    it('expands ~ to home directory', () => {
      expect(expandPath('~', fs)).toBe('/home/test');
    });

    it('expands ~/path', () => {
      expect(expandPath('~/projects', fs)).toBe('/home/test/projects');
    });

    it('does not expand ~ in the middle of a string', () => {
      expect(expandPath('/foo/~/bar', fs)).toBe('/foo/~/bar');
    });

    it('does not expand ~username', () => {
      expect(expandPath('~root/bin', fs)).toBe('~root/bin');
    });

    it('uses fs.homedir() for ~ expansion', () => {
      const customFs = new MemoryFileSystem({}, '/custom/home');
      expect(expandPath('~/projects', customFs)).toBe('/custom/home/projects');
    });

    it('expands bare ~ using fs.homedir()', () => {
      const overrideFs = new MemoryFileSystem({}, '/override');
      expect(expandPath('~', overrideFs)).toBe('/override');
    });
  });

  describe('env var expansion', () => {
    it('expands $VAR', () => {
      process.env['TEST_EXPAND_VAR'] = '/test/value';
      expect(expandPath('$TEST_EXPAND_VAR', fs)).toBe('/test/value');
      delete process.env['TEST_EXPAND_VAR'];
    });

    it('expands ${VAR}', () => {
      process.env['TEST_EXPAND_VAR'] = '/test/value';
      expect(expandPath('${TEST_EXPAND_VAR}/sub', fs)).toBe('/test/value/sub');
      delete process.env['TEST_EXPAND_VAR'];
    });

    it('expands $HOME', () => {
      expect(expandPath('$HOME', fs)).toBe(process.env['HOME']);
    });

    it('expands ${HOME}/path', () => {
      expect(expandPath('${HOME}/foo', fs)).toBe(`${process.env['HOME']}/foo`);
    });

    it('expands multiple vars in one string', () => {
      process.env['TEST_A'] = 'foo';
      process.env['TEST_B'] = 'bar';
      expect(expandPath('$TEST_A/$TEST_B', fs)).toBe('foo/bar');
      delete process.env['TEST_A'];
      delete process.env['TEST_B'];
    });

    it('replaces undefined var with empty string', () => {
      expect(expandPath('$THIS_VAR_DOES_NOT_EXIST_XYZ', fs)).toBe('');
    });
  });

  describe('plain paths', () => {
    it('returns absolute paths unchanged', () => {
      expect(expandPath('/usr/local/bin', fs)).toBe('/usr/local/bin');
    });

    it('returns plain program names unchanged', () => {
      expect(expandPath('git', fs)).toBe('git');
    });
  });

  describe('undefined handling', () => {
    it('returns undefined for undefined input', () => {
      expect(expandPath(undefined, fs)).toBeUndefined();
    });

    it('returns undefined for undefined input when fs is provided', () => {
      const otherFs = new MemoryFileSystem({}, '/custom');
      expect(expandPath(undefined, otherFs)).toBeUndefined();
    });
  });
});
