import { describe, expect, it } from 'vitest';
import type { Step, ValidationRule } from '../src/mcp/shellicar/exec/types.js';
import { builtinRules } from '../src/mcp/shellicar/validation/consts.js';
import { validate } from '../src/mcp/shellicar/validation/validate.js';

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
  if (!rule) {
    throw new Error(`Rule '${name}' not found in builtinRules`);
  }
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
    });

    it('blocks dd', () => {
      const result = checkRule('no-destructive-commands', cmd('dd', ['if=/dev/zero', 'of=/dev/sda']));
      expect(result.allowed).toBe(false);
    });

    it('blocks shred', () => {
      const result = checkRule('no-destructive-commands', cmd('shred', ['-u', 'file.txt']));
      expect(result.allowed).toBe(false);
    });

    it('allows safe commands', () => {
      expect(checkRule('no-destructive-commands', cmd('git', ['status'])).allowed).toBe(true);
      expect(checkRule('no-destructive-commands', cmd('ls', ['-la'])).allowed).toBe(true);
    });

    it('blocks inside pipeline', () => {
      const step = pipeline({ program: 'echo', args: ['y'] }, { program: 'rm', args: ['-rf', '/'] });
      expect(checkRule('no-destructive-commands', step).allowed).toBe(false);
    });
  });

  describe('no-xargs', () => {
    it('blocks xargs', () => {
      const result = checkRule('no-xargs', cmd('xargs', ['rm']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('xargs');
    });

    it('blocks xargs in pipeline', () => {
      const step = pipeline({ program: 'find', args: ['.'] }, { program: 'xargs', args: ['rm'] });
      expect(checkRule('no-xargs', step).allowed).toBe(false);
    });

    it('allows non-xargs commands', () => {
      expect(checkRule('no-xargs', cmd('find', ['.'])).allowed).toBe(true);
    });
  });

  describe('no-sed-in-place', () => {
    it('blocks sed -i', () => {
      const result = checkRule('no-sed-in-place', cmd('sed', ['-i', 's/foo/bar/', 'file.txt']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('sed -i');
    });

    it('blocks sed --in-place', () => {
      expect(checkRule('no-sed-in-place', cmd('sed', ['--in-place', 's/foo/bar/', 'file.txt'])).allowed).toBe(false);
    });

    it('blocks sed -ni (combined flags)', () => {
      expect(checkRule('no-sed-in-place', cmd('sed', ['-ni', 's/foo/bar/p', 'file.txt'])).allowed).toBe(false);
    });

    it('blocks sed -Ei (combined flags)', () => {
      expect(checkRule('no-sed-in-place', cmd('sed', ['-Ei', 's/foo/bar/', 'file.txt'])).allowed).toBe(false);
    });

    it('allows read-only sed (no -i)', () => {
      expect(checkRule('no-sed-in-place', cmd('sed', ['s/foo/bar/', 'file.txt'])).allowed).toBe(true);
    });

    it('allows sed -e (expression, no in-place)', () => {
      expect(checkRule('no-sed-in-place', cmd('sed', ['-e', 's/foo/bar/'])).allowed).toBe(true);
    });

    it('allows sed -n (suppress, no in-place)', () => {
      expect(checkRule('no-sed-in-place', cmd('sed', ['-n', '/pattern/p', 'file.txt'])).allowed).toBe(true);
    });

    it('allows sed in read-only pipeline', () => {
      const step = pipeline({ program: 'cat', args: ['file'] }, { program: 'sed', args: ['s/a/b/'] });
      expect(checkRule('no-sed-in-place', step).allowed).toBe(true);
    });

    it('blocks sed -i in pipeline', () => {
      const step = pipeline({ program: 'cat', args: ['file'] }, { program: 'sed', args: ['-i', 's/a/b/'] });
      expect(checkRule('no-sed-in-place', step).allowed).toBe(false);
    });
  });

  describe('no-git-rm', () => {
    it('blocks git rm', () => {
      const result = checkRule('no-git-rm', cmd('git', ['rm', 'file']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('git rm');
    });

    it('blocks git rm with options before rm', () => {
      const result = checkRule('no-git-rm', cmd('git', ['--git-dir=/path', 'rm', 'file']));
      expect(result.allowed).toBe(false);
    });

    it('allows git status', () => {
      expect(checkRule('no-git-rm', cmd('git', ['status'])).allowed).toBe(true);
    });

    it('allows docker --rm', () => {
      expect(checkRule('no-git-rm', cmd('docker', ['run', '--rm', 'image'])).allowed).toBe(true);
    });
  });

  describe('no-git-checkout', () => {
    it('blocks git checkout', () => {
      const result = checkRule('no-git-checkout', cmd('git', ['checkout', '--', 'file']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('git checkout');
      expect(result.errors[0]).toContain('git switch');
    });

    it('blocks git checkout with options', () => {
      const result = checkRule('no-git-checkout', cmd('git', ['--no-pager', 'checkout', 'main']));
      expect(result.allowed).toBe(false);
    });

    it('allows git switch', () => {
      expect(checkRule('no-git-checkout', cmd('git', ['switch', 'main'])).allowed).toBe(true);
    });
  });

  describe('no-git-reset', () => {
    it('blocks git reset', () => {
      const result = checkRule('no-git-reset', cmd('git', ['reset', '--hard', 'HEAD']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('git reset');
    });

    it('blocks git reset with options', () => {
      const result = checkRule('no-git-reset', cmd('git', ['--no-pager', 'reset', '--hard']));
      expect(result.allowed).toBe(false);
    });

    it('allows git commit --reset-author', () => {
      expect(checkRule('no-git-reset', cmd('git', ['commit', '--amend', '--reset-author'])).allowed).toBe(true);
    });

    it('allows git add reset.ts', () => {
      expect(checkRule('no-git-reset', cmd('git', ['add', 'reset.ts'])).allowed).toBe(true);
    });
  });

  describe('no-force-push', () => {
    it('blocks git push --force', () => {
      const result = checkRule('no-force-push', cmd('git', ['push', '--force']));
      expect(result.allowed).toBe(false);
    });

    it('blocks git push -f', () => {
      expect(checkRule('no-force-push', cmd('git', ['push', '-f'])).allowed).toBe(false);
    });

    it('blocks git push --force-with-lease', () => {
      expect(checkRule('no-force-push', cmd('git', ['push', '--force-with-lease'])).allowed).toBe(false);
    });

    it('blocks git push origin main --force', () => {
      expect(checkRule('no-force-push', cmd('git', ['push', 'origin', 'main', '--force'])).allowed).toBe(false);
    });

    it('allows git push', () => {
      expect(checkRule('no-force-push', cmd('git', ['push'])).allowed).toBe(true);
    });

    it('allows git push origin main', () => {
      expect(checkRule('no-force-push', cmd('git', ['push', 'origin', 'main'])).allowed).toBe(true);
    });

    it('blocks force push in pipeline', () => {
      const step = pipeline({ program: 'echo', args: ['pushing'] }, { program: 'git', args: ['push', '--force'] });
      expect(checkRule('no-force-push', step).allowed).toBe(false);
    });
  });

  describe('no-git-C', () => {
    it('blocks git -C', () => {
      const result = checkRule('no-git-C', cmd('git', ['-C', '/path', 'status']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('auto-approve');
    });

    it('blocks git -C mid-command', () => {
      expect(checkRule('no-git-C', cmd('git', ['--no-pager', '-C', '/path', 'log'])).allowed).toBe(false);
    });

    it('allows git -c (lowercase)', () => {
      expect(checkRule('no-git-C', cmd('git', ['-c', 'core.autocrlf=false', 'status'])).allowed).toBe(true);
    });
  });

  describe('no-pnpm-C', () => {
    it('blocks pnpm -C', () => {
      const result = checkRule('no-pnpm-C', cmd('pnpm', ['-C', '/path', 'run', 'build']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('auto-approve');
    });

    it('allows pnpm run build', () => {
      expect(checkRule('no-pnpm-C', cmd('pnpm', ['run', 'build'])).allowed).toBe(true);
    });
  });

  describe('no-exe', () => {
    it('blocks cmd.exe', () => {
      const result = checkRule('no-exe', cmd('cmd.exe', ['/c', 'dir']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('.exe');
    });

    it('blocks powershell.exe', () => {
      expect(checkRule('no-exe', cmd('powershell.exe', ['-Command', 'Get-Process'])).allowed).toBe(false);
    });

    it('blocks pwsh.exe', () => {
      expect(checkRule('no-exe', cmd('pwsh.exe', ['-c', 'ls'])).allowed).toBe(false);
    });

    it('allows normal commands', () => {
      expect(checkRule('no-exe', cmd('node', ['app.js'])).allowed).toBe(true);
    });
  });

  describe('no-sudo', () => {
    it('blocks sudo', () => {
      const result = checkRule('no-sudo', cmd('sudo', ['apt-get', 'install', 'vim']));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('sudo');
    });

    it('allows non-sudo commands', () => {
      expect(checkRule('no-sudo', cmd('apt-get', ['install', 'vim'])).allowed).toBe(true);
    });
  });

  describe('no-env-dump', () => {
    it('blocks env with no args', () => {
      const result = checkRule('no-env-dump', cmd('env'));
      expect(result.allowed).toBe(false);
      expect(result.errors[0]).toContain('without arguments');
    });

    it('allows env with args', () => {
      expect(checkRule('no-env-dump', cmd('env', ['NODE_ENV=test', 'node', 'app.js'])).allowed).toBe(true);
    });

    it('blocks printenv with no args', () => {
      expect(checkRule('no-env-dump', cmd('printenv')).allowed).toBe(false);
    });

    it('allows printenv with a specific variable', () => {
      expect(checkRule('no-env-dump', cmd('printenv', ['HOME'])).allowed).toBe(true);
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
      // sudo triggers no-sudo (rm is an arg, not a program), env triggers no-env-dump
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('returns errors prefixed with rule name', () => {
      const result = validate([cmd('rm', ['file.txt'])], builtinRules);
      expect(result.errors[0]).toMatch(/^\[no-destructive-commands\]/);
    });
  });
});
