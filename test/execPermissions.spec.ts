import { ExecInputSchema } from '@shellicar/mcp-exec';
import { describe, expect, it } from 'vitest';
import { type ApproveRule, type ExecPermissions, isExecPermitted, matchRules } from '../src/mcp/shellicar/autoApprove';

const HOME = '/home/testuser';
const CWD = '/tmp';

function match(resolvedPath: string, commandArgs: string[], rules: ApproveRule[]) {
  return matchRules(resolvedPath, commandArgs, rules, CWD, HOME);
}

describe('matchRules', () => {
  it('matches rule by program basename', () => {
    const expected: ApproveRule = { program: 'git' };
    const rules: ApproveRule[] = [expected];

    const actual = match('/usr/bin/git', [], rules);

    expect(actual).toEqual([expected]);
  });

  it('matches rule by exact absolute path', () => {
    const expected: ApproveRule = { program: '/usr/bin/git' };
    const rules: ApproveRule[] = [expected];

    const actual = match('/usr/bin/git', [], rules);

    expect(actual).toEqual([expected]);
  });

  it('expands ~ in rule program before matching', () => {
    const expected: ApproveRule = { program: '~/.claude/skills/git-commit/scripts/info.sh' };
    const rules: ApproveRule[] = [expected];

    const actual = match(`${HOME}/.claude/skills/git-commit/scripts/info.sh`, [], rules);

    expect(actual).toEqual([expected]);
  });

  it('matches glob pattern with * in rule program', () => {
    const expected: ApproveRule = { program: '~/.claude/skills/*/scripts/*.sh' };
    const rules: ApproveRule[] = [expected];

    const actual = match(`${HOME}/.claude/skills/git-commit/scripts/info.sh`, [], rules);

    expect(actual).toEqual([expected]);
  });

  it('matches when all rule args are present in command args', () => {
    const expected: ApproveRule = { program: 'git', args: ['push'] };
    const rules: ApproveRule[] = [expected];

    const actual = match('/usr/bin/git', ['push', 'origin', 'main'], rules);

    expect(actual).toEqual([expected]);
  });

  it('matches when rule has no args regardless of command args', () => {
    const expected: ApproveRule = { program: 'git' };
    const rules: ApproveRule[] = [expected];

    const actual = match('/usr/bin/git', ['push', '--force', 'origin'], rules);

    expect(actual).toEqual([expected]);
  });

  it('rejects when rule args are not all present in command args', () => {
    const rules: ApproveRule[] = [{ program: 'git', args: ['push', '--force'] }];

    const actual = match('/usr/bin/git', ['push', 'origin'], rules);

    expect(actual).toEqual([]);
  });

  // Args matching is subset membership, not exact equality.
  // { args: ['push'] } matches ['push', '--force'] because 'push' is present.
  // You cannot prevent force-push with approve rules alone. Deny rules are needed (not yet implemented).
  it('args check is subset: approve push also matches push --force', () => {
    const expected: ApproveRule = { program: 'git', args: ['push'] };
    const rules: ApproveRule[] = [expected];

    const actual = match('/usr/bin/git', ['push', '--force', 'origin'], rules);

    expect(actual).toEqual([expected]);
  });

  // Matching is positional-unaware: 'push' as a flag value (git -c push ...) is
  // indistinguishable from 'push' as a subcommand. An approve rule for
  // { args: ['push'] } will match both.
  //
  // The long-term mitigation is tool-aware normalization (not yet implemented):
  // before matching, known flag-value pairs are stripped for specific programs.
  // For git, '-c <val>' would be removed, so 'git -c push remote remove origin'
  // normalizes to args ['remote', 'remove', 'origin'] before rules are checked.
  // This eliminates the ambiguity structurally rather than requiring an
  // exhaustive deny list.
  it('args check is positional-unaware: push as -c value falsely matches push approve rule', () => {
    const expected: ApproveRule = { program: 'git', args: ['push'] };
    const rules: ApproveRule[] = [expected];

    // git -c push remote remove origin -- 'push' is a -c flag value, not the subcommand
    const actual = match('/usr/bin/git', ['-c', 'push', 'remote', 'remove', 'origin'], rules);

    expect(actual).toEqual([expected]);
  });

  it('rejects when rule requires args but command has none', () => {
    const rules: ApproveRule[] = [{ program: 'git', args: ['status'] }];

    const actual = match('/usr/bin/git', [], rules);

    expect(actual).toEqual([]);
  });

  it('rejects when program does not match any rule', () => {
    const rules: ApproveRule[] = [{ program: 'git' }];

    const actual = match('/usr/bin/curl', [], rules);

    expect(actual).toEqual([]);
  });

  it('returns multiple matching rules', () => {
    const rule1: ApproveRule = { program: 'git' };
    const rule2: ApproveRule = { program: 'git', args: ['status'] };
    const rules: ApproveRule[] = [rule1, rule2];

    const actual = match('/usr/bin/git', ['status'], rules);

    expect(actual).toEqual([rule1, rule2]);
  });
});

function input(steps: Array<Record<string, unknown>>) {
  return ExecInputSchema.parse({ description: 'test', steps });
}

function permitted(execInput: ReturnType<typeof input>, permissions: ExecPermissions) {
  return isExecPermitted(execInput, permissions, CWD, HOME);
}

describe('isExecPermitted', () => {
  it('permits when command matches an approve rule', () => {
    const expected = true;

    const actual = permitted(input([{ commands: [{ program: '/usr/bin/git' }] }]), {
      approve: [{ program: 'git' }],
    });

    expect(actual).toBe(expected);
  });

  it('denies when command does not match any approve rule', () => {
    const expected = false;

    const actual = permitted(input([{ commands: [{ program: '/usr/bin/curl' }] }]), {
      approve: [{ program: 'git' }],
    });

    expect(actual).toBe(expected);
  });

  it('denies when any command in a multi-step input is not permitted', () => {
    const expected = false;

    const actual = permitted(input([{ commands: [{ program: '/usr/bin/git' }] }, { commands: [{ program: '/usr/bin/curl' }] }]), { approve: [{ program: 'git' }] });

    expect(actual).toBe(expected);
  });

  it('denies when no approve rules exist', () => {
    const expected = false;

    const actual = permitted(input([{ commands: [{ program: '/usr/bin/git' }] }]), {});

    expect(actual).toBe(expected);
  });

  it('permits with args matching', () => {
    const expected = true;

    const actual = permitted(input([{ commands: [{ program: '/usr/bin/git', args: ['status'] }] }]), {
      approve: [{ program: 'git', args: ['status'] }],
    });

    expect(actual).toBe(expected);
  });

  it('denies when args do not match', () => {
    const expected = false;

    const actual = permitted(input([{ commands: [{ program: '/usr/bin/git', args: ['push', '--force'] }] }]), {
      approve: [{ program: 'git', args: ['status'] }],
    });

    expect(actual).toBe(expected);
  });

  it('permits skill scripts when "defaults" preset is active', () => {
    const expected = true;

    const actual = permitted(input([{ commands: [{ program: `${HOME}/.claude/skills/git-commit/scripts/info.sh` }] }]), { presets: ['defaults'] });

    expect(actual).toBe(expected);
  });

  it('does not permit non-skill paths with "defaults" preset', () => {
    const expected = false;

    const actual = permitted(input([{ commands: [{ program: '/usr/bin/curl' }] }]), { presets: ['defaults'] });

    expect(actual).toBe(expected);
  });

  it('combines preset and user-defined approve rules', () => {
    const expected = true;

    const actual = permitted(input([{ commands: [{ program: `${HOME}/.claude/skills/git-commit/scripts/info.sh` }] }, { commands: [{ program: '/usr/bin/git', args: ['status'] }] }]), { presets: ['defaults'], approve: [{ program: 'git', args: ['status'] }] });

    expect(actual).toBe(expected);
  });

  it('resolves relative program paths against default cwd', () => {
    const expected = true;

    const actual = permitted(input([{ commands: [{ program: 'git' }] }]), {
      approve: [{ program: `${CWD}/git` }],
    });

    expect(actual).toBe(expected);
  });

  it('ignores unknown preset names', () => {
    const expected = false;

    const actual = permitted(input([{ commands: [{ program: '/usr/bin/git' }] }]), {
      presets: ['nonexistent'],
    });

    expect(actual).toBe(expected);
  });

  it('permits skill scripts when program uses ~ prefix', () => {
    const expected = true;

    const actual = permitted(input([{ commands: [{ program: '~/.claude/skills/git-commit/scripts/info.sh' }] }]), { presets: ['defaults'] });

    expect(actual).toBe(expected);
  });
});
