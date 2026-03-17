import { describe, expect, it } from 'vitest';
import type { Step } from './schema.js';
import { builtinRules, validate, type ValidationRule } from './validation.js';

/** Helper: create a single command step */
function cmd(program: string, args: string[] = []): Step {
  return { type: 'command', program, args };
}

/** Helper: create a pipeline step */
function pipeline(...commands: { program: string; args?: string[] }[]): Step {
  return {
    type: 'pipeline',
    commands: commands.map((c) => ({ program: c.program, args: c.args ?? [] })),
  };
}

/** Helper: find a specific builtin rule by name */
function findRule(name: string): ValidationRule {
  const rule = builtinRules.find((r) => r.name === name);
  if (!rule) throw new Error(`Rule '${name}' not found in builtinRules`);
  return rule;
}

/** Helper: validate a single step against a single rule */
function checkRule(ruleName: string, step: Step): { allowed: boolean; errors: string[] } {
  return validate([step], [findRule(ruleName)]);
}

describe('validation', () => {
  describe('no-destructive-commands', () => {
    it('blocks rm', () => {
      const result = checkRule('no-destructive-commands', cmd('rm', ['-rf', '/tmp/foo']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('rm');
    });

    it('blocks rmdir', () => {
      const result = checkRule('no-destructive-commands', cmd('rmdir', ['foo']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('rmdir');
    });

    it('allows git', () => {
      const result = checkRule('no-destructive-commands', cmd('git', ['status']));
      expect(result.allowed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('allows ls', () => {
      const result = checkRule('no-destructive-commands', cmd('ls', ['-la']));
      expect(result.allowed).toBe(true);
    });

    it('blocks destructive command inside a pipeline', () => {
      const step = pipeline({ program: 'echo', args: ['y'] }, { program: 'rm', args: ['-rf', '/'] });
      const result = checkRule('no-destructive-commands', step);
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('rm');
    });
  });

  describe('no-force-push', () => {
    it('blocks git push --force', () => {
      const result = checkRule('no-force-push', cmd('git', ['push', '--force']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('Force push');
    });

    it('blocks git push -f', () => {
      const result = checkRule('no-force-push', cmd('git', ['push', '-f']));
      expect(result.allowed).toBe(false);
    });

    it('allows git push', () => {
      const result = checkRule('no-force-push', cmd('git', ['push']));
      expect(result.allowed).toBe(true);
    });

    it('allows git push --force-with-lease', () => {
      const result = checkRule('no-force-push', cmd('git', ['push', '--force-with-lease']));
      expect(result.allowed).toBe(true);
    });

    it('blocks force push inside a pipeline', () => {
      const step = pipeline({ program: 'echo', args: ['pushing'] }, { program: 'git', args: ['push', '--force'] });
      const result = checkRule('no-force-push', step);
      expect(result.allowed).toBe(false);
    });
  });

  describe('no-sudo', () => {
    it('blocks sudo', () => {
      const result = checkRule('no-sudo', cmd('sudo', ['apt-get', 'install', 'vim']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('sudo');
    });

    it('allows non-sudo commands', () => {
      const result = checkRule('no-sudo', cmd('apt-get', ['install', 'vim']));
      expect(result.allowed).toBe(true);
    });
  });

  describe('no-env-dump', () => {
    it('blocks env with no args', () => {
      const result = checkRule('no-env-dump', cmd('env'));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('env');
      expect(result.errors[0]).toContain('without arguments');
    });

    it('allows env with args', () => {
      const result = checkRule('no-env-dump', cmd('env', ['NODE_ENV=test', 'node', 'app.js']));
      expect(result.allowed).toBe(true);
    });

    it('blocks printenv with no args', () => {
      const result = checkRule('no-env-dump', cmd('printenv'));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('printenv');
    });

    it('allows printenv with a specific variable', () => {
      const result = checkRule('no-env-dump', cmd('printenv', ['HOME']));
      expect(result.allowed).toBe(true);
    });
  });

  describe('validate with all builtin rules', () => {
    it('allows safe commands', () => {
      const steps: Step[] = [cmd('git', ['status']), cmd('ls', ['-la'])];
      const result = validate(steps, builtinRules);
      expect(result.allowed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('collects multiple errors from different rules', () => {
      const steps: Step[] = [cmd('sudo', ['rm', '-rf', '/']), cmd('env')];
      const result = validate(steps, builtinRules);
      expect(result.allowed).toBe(false);
      // sudo step triggers no-sudo, env step triggers no-env-dump
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('returns errors prefixed with rule name', () => {
      const result = validate([cmd('rm', ['file.txt'])], builtinRules);
      expect(result.errors[0]).toMatch(/^\[no-destructive-commands\]/);
    });
  });
});
