import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryFileSystem } from './MemoryFileSystem';
import { expandPath } from '@shellicar/claude-core/fs/expandPath';

describe('expandPath', () => {

  let fs: MemoryFileSystem;
  beforeEach(() => {
    fs = new MemoryFileSystem({}, '/home/test')
  });

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
      fs.setEnvVar('TEST_EXPAND_VAR', '/test/value');
      expect(expandPath('$TEST_EXPAND_VAR', fs)).toBe('/test/value');
    });

    it('expands ${VAR}', () => {

      const expected = '/test/value/sub';
      fs.setEnvVar('TEST_EXPAND_VAR', '/test/value');

      const actual = expandPath('${TEST_EXPAND_VAR}/sub', fs);

      expect(actual).toBe(expected);
    });

    it('expands $HOME', () => {
      const expected = '/home/hello';
      fs.setEnvVar('HOME', expected);

      const actual = expandPath('$HOME', fs);

      expect(actual).toBe(expected);
    });

    it('expands ${HOME}/path', () => {

      const expected = '/home/hello/foo';
      fs.setEnvVar('HOME', '/home/hello');

      const actual = expandPath('${HOME}/foo', fs);

      expect(actual).toBe(expected);
    });

    it('expands multiple vars in one string', () => {
      fs.setEnvVar('TEST_A', 'foo');
      fs.setEnvVar('TEST_B', 'bar');

      const actual = expandPath('$TEST_A/$TEST_B', fs);
      const expected = 'foo/bar';

      expect(actual).toBe(expected);
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
