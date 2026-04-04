import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { expandPath } from '../src/expandPath';

describe('expandPath', () => {
  describe('tilde expansion', () => {
    it('expands ~ to home directory', () => {
      expect(expandPath('~')).toBe(homedir());
    });

    it('expands ~/path', () => {
      expect(expandPath('~/projects')).toBe(`${homedir()}/projects`);
    });

    it('does not expand ~ in the middle of a string', () => {
      expect(expandPath('/foo/~/bar')).toBe('/foo/~/bar');
    });

    it('does not expand ~username', () => {
      expect(expandPath('~root/bin')).toBe('~root/bin');
    });

    it('uses options.home override instead of os.homedir()', () => {
      expect(expandPath('~/projects', { home: '/custom/home' })).toBe('/custom/home/projects');
    });

    it('expands bare ~ with options.home override', () => {
      expect(expandPath('~', { home: '/override' })).toBe('/override');
    });
  });

  describe('env var expansion', () => {
    it('expands $VAR', () => {
      process.env['TEST_EXPAND_VAR'] = '/test/value';
      expect(expandPath('$TEST_EXPAND_VAR')).toBe('/test/value');
      delete process.env['TEST_EXPAND_VAR'];
    });

    it('expands ${VAR}', () => {
      process.env['TEST_EXPAND_VAR'] = '/test/value';
      expect(expandPath('${TEST_EXPAND_VAR}/sub')).toBe('/test/value/sub');
      delete process.env['TEST_EXPAND_VAR'];
    });

    it('expands $HOME', () => {
      expect(expandPath('$HOME')).toBe(process.env['HOME']);
    });

    it('expands ${HOME}/path', () => {
      expect(expandPath('${HOME}/foo')).toBe(`${process.env['HOME']}/foo`);
    });

    it('expands multiple vars in one string', () => {
      process.env['TEST_A'] = 'foo';
      process.env['TEST_B'] = 'bar';
      expect(expandPath('$TEST_A/$TEST_B')).toBe('foo/bar');
      delete process.env['TEST_A'];
      delete process.env['TEST_B'];
    });

    it('replaces undefined var with empty string', () => {
      expect(expandPath('$THIS_VAR_DOES_NOT_EXIST_XYZ')).toBe('');
    });
  });

  describe('plain paths', () => {
    it('returns absolute paths unchanged', () => {
      expect(expandPath('/usr/local/bin')).toBe('/usr/local/bin');
    });

    it('returns plain program names unchanged', () => {
      expect(expandPath('git')).toBe('git');
    });
  });

  describe('undefined handling', () => {
    it('returns undefined for undefined input', () => {
      expect(expandPath(undefined)).toBeUndefined();
    });

    it('returns undefined for undefined with options', () => {
      expect(expandPath(undefined, { home: '/custom' })).toBeUndefined();
    });
  });
});
