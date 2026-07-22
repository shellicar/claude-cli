import { ToolRefusedError } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import { StaticRulesConfigProvider } from '../../src/Exec/IRulesConfigProvider';
import { supersededGitRules } from '../../src/Exec/ruleConfig';
import { createExecV3 } from '../../src/ExecV3/ExecV3';
import { FakeExecutor, shellLikeResponder } from '../FakeExecutor';
import { call } from '../helpers';
import { MemoryFileSystem } from '../MemoryFileSystem';

// Built-in rule coverage — one describe per rule. Every case runs against FakeExecutor only:
// a rule-verification test must never be able to run the command for real if the rule has a
// matching bug (see the CLAUDE.md test-safety rule, and the incident that motivated it).

const ExecV3 = createExecV3(new MemoryFileSystem(), new FakeExecutor(shellLikeResponder()), { buildEnv: (cmdEnv) => ({ ...process.env, ...cmdEnv }) });

async function blocked(commands: { program: string; args?: string[] }[]) {
  const actual = call(ExecV3, { intent: 'test', commands });
  await expect(actual).rejects.toBeInstanceOf(ToolRefusedError);
}

// supersededGitRules is no longer part of defaultRules — no-raw-git blocks git outright, so
// these are inert unless a config opts back into them explicitly. Build a dedicated instance per
// describe block that does exactly that (with no-raw-git nulled out), so each test proves the
// specific rule's own matcher/message, not just that git is blocked at all for some other reason.
function execV3WithSupersededRule(name: keyof typeof supersededGitRules) {
  return createExecV3(new MemoryFileSystem(), new FakeExecutor(shellLikeResponder()), { buildEnv: (cmdEnv) => ({ ...process.env, ...cmdEnv }) }, new StaticRulesConfigProvider({ 'no-raw-git': null, [name]: supersededGitRules[name] }));
}

async function blockedBySuperseded(name: keyof typeof supersededGitRules, commands: { program: string; args?: string[] }[]) {
  const actual = call(execV3WithSupersededRule(name), { intent: 'test', commands });
  await expect(actual).rejects.toBeInstanceOf(ToolRefusedError);
}

describe('no-destructive-commands — rm -rf /tmp/whatever', () => {
  it('refuses rm', async () => {
    await blocked([{ program: 'rm', args: ['-rf', '/tmp/whatever'] }]);
  });
});

describe('no-xargs — xargs rm', () => {
  it('refuses xargs', async () => {
    await blocked([{ program: 'xargs', args: ['rm'] }]);
  });
});

describe('no-sed-in-place', () => {
  it('refuses "sed -i"', async () => {
    await blocked([{ program: 'sed', args: ['-i', 's/a/b/', 'file'] }]);
  });

  it('refuses the bundled short-flag form "sed -ni"', async () => {
    await blocked([{ program: 'sed', args: ['-ni', 'p', 'file'] }]);
  });

  it('allows sed without -i', async () => {
    const result = await call(ExecV3, { intent: 'test', commands: [{ program: 'sed', args: ['s/a/b/', 'file'] }] });
    const expected = true;
    const actual = result.results[0]?.exitCode !== undefined;
    expect(actual).toBe(expected);
  });
});

describe('no-git-rm (superseded by no-raw-git; opt back in via config) — git rm file', () => {
  it('refuses git rm', async () => {
    await blockedBySuperseded('no-git-rm', [{ program: 'git', args: ['rm', 'file'] }]);
  });
});

describe('no-git-checkout (superseded by no-raw-git; opt back in via config) — git checkout .', () => {
  it('refuses git checkout', async () => {
    await blockedBySuperseded('no-git-checkout', [{ program: 'git', args: ['checkout', '.'] }]);
  });
});

describe('no-git-reset (superseded by no-raw-git; opt back in via config) — git reset --hard', () => {
  it('refuses git reset', async () => {
    await blockedBySuperseded('no-git-reset', [{ program: 'git', args: ['reset', '--hard'] }]);
  });
});

describe('no-git-clean (superseded by no-raw-git; opt back in via config) — git clean -fd', () => {
  it('refuses git clean', async () => {
    await blockedBySuperseded('no-git-clean', [{ program: 'git', args: ['clean', '-fd'] }]);
  });
});

describe('no-force-push (superseded by no-raw-git; opt back in via config)', () => {
  it('refuses "git push -f"', async () => {
    await blockedBySuperseded('no-force-push', [{ program: 'git', args: ['push', '-f'] }]);
  });

  it('refuses "git push --force"', async () => {
    await blockedBySuperseded('no-force-push', [{ program: 'git', args: ['push', '--force'] }]);
  });

  it('refuses "git push --force-with-lease=main:abc" (attached value)', async () => {
    await blockedBySuperseded('no-force-push', [{ program: 'git', args: ['push', '--force-with-lease=main:abc'] }]);
  });

  it('names the rule in the refusal reason', async () => {
    const actual = call(execV3WithSupersededRule('no-force-push'), { intent: 'test', commands: [{ program: 'git', args: ['push', '-f'] }] });
    await expect(actual).rejects.toThrow('no-force-push');
  });
});

describe('no-git-C (superseded by no-raw-git; opt back in via config)', () => {
  it('refuses "git -C /tmp status"', async () => {
    await blockedBySuperseded('no-git-C', [{ program: 'git', args: ['-C', '/tmp', 'status'] }]);
  });

  it('refuses "git --work-tree /tmp status"', async () => {
    await blockedBySuperseded('no-git-C', [{ program: 'git', args: ['--work-tree', '/tmp', 'status'] }]);
  });

  it('refuses "git --git-dir /tmp/.git status"', async () => {
    await blockedBySuperseded('no-git-C', [{ program: 'git', args: ['--git-dir', '/tmp/.git', 'status'] }]);
  });

  it('refuses "git -c core.pager=id log" (config injection)', async () => {
    await blockedBySuperseded('no-git-C', [{ program: 'git', args: ['-c', 'core.pager=id', 'log'] }]);
  });
});

describe('no-raw-git — the Git_* tools are the only door to git, not just the recommended one', () => {
  it('refuses a benign git call the other, more specific git rules never covered (git status)', async () => {
    await blocked([{ program: 'git', args: ['status'] }]);
  });

  it('refuses git config --list, which no other git rule matches at all', async () => {
    await blocked([{ program: 'git', args: ['config', '--list'] }]);
  });

  it('names the rule in the refusal reason', async () => {
    const actual = call(ExecV3, { intent: 'test', commands: [{ program: 'git', args: ['status'] }] });
    await expect(actual).rejects.toThrow('no-raw-git');
  });

  it('is itself removable via config, same as any other built-in rule', async () => {
    const configured = createExecV3(new MemoryFileSystem(), new FakeExecutor(shellLikeResponder()), { buildEnv: (cmdEnv) => ({ ...process.env, ...cmdEnv }) }, new StaticRulesConfigProvider({ 'no-raw-git': null }));
    const result = await call(configured, { intent: 'test', commands: [{ program: 'git', args: ['status'] }] });
    const expected = true;
    const actual = result.results[0]?.exitCode !== undefined;
    expect(actual).toBe(expected);
  });
});

describe('no-inline-interpreter — the review-channel bypass', () => {
  it('refuses "sh -c \'rm -rf /tmp/x\'"', async () => {
    await blocked([{ program: 'sh', args: ['-c', 'rm -rf /tmp/x'] }]);
  });

  it('refuses "bash -c" with a for loop', async () => {
    await blocked([{ program: 'bash', args: ['-c', 'for f in *; do rm "$f"; done'] }]);
  });

  it('refuses "python3 -c" inline code', async () => {
    await blocked([{ program: 'python3', args: ['-c', "import os; os.system('id')"] }]);
  });

  it('refuses "node -e" inline code', async () => {
    await blocked([{ program: 'node', args: ['-e', "console.log('x')"] }]);
  });

  it('allows sh running a script file (the reviewable path)', async () => {
    const result = await call(ExecV3, { intent: 'test', commands: [{ program: 'sh', args: ['/nonexistent/script.sh'] }] });
    const expected = true;
    const actual = result.results[0]?.exitCode !== undefined;
    expect(actual).toBe(expected);
  });
});

describe('no-find-exec — find . -exec rm {} \\;', () => {
  it('refuses find -exec (target is deliberately nonexistent — a rule-block test must never point at a real command)', async () => {
    await blocked([{ program: 'find', args: ['/nonexistent/does-not-exist', '-exec', 'rm', '{}', ';'] }]);
  });
});

describe('no-pnpm-C — pnpm -C /tmp build', () => {
  it('refuses pnpm -C', async () => {
    await blocked([{ program: 'pnpm', args: ['-C', '/tmp', 'build'] }]);
  });
});

describe('no-exe — whatever.exe', () => {
  it('refuses a program ending in .exe', async () => {
    await blocked([{ program: 'whatever.exe', args: [] }]);
  });
});

describe('no-sudo — sudo ls', () => {
  it('refuses sudo', async () => {
    await blocked([{ program: 'sudo', args: ['ls'] }]);
  });
});

describe('no-env-dump', () => {
  it('refuses bare "env"', async () => {
    await blocked([{ program: 'env', args: [] }]);
  });

  it('refuses bare "printenv"', async () => {
    await blocked([{ program: 'printenv', args: [] }]);
  });

  it('allows "env" with an explicit variable', async () => {
    const result = await call(ExecV3, { intent: 'test', commands: [{ program: 'env', args: ['PATH'] }] });
    const expected = true;
    const actual = result.results[0]?.exitCode !== undefined;
    expect(actual).toBe(expected);
  });
});

describe('rule config — a key set to null removes a built-in rule', () => {
  it('allows sudo once no-sudo is set to null in config', async () => {
    const configured = createExecV3(new MemoryFileSystem(), new FakeExecutor(shellLikeResponder()), { buildEnv: (cmdEnv) => ({ ...process.env, ...cmdEnv }) }, new StaticRulesConfigProvider({ 'no-sudo': null }));
    const result = await call(configured, { intent: 'test', commands: [{ program: 'sudo', args: ['-n', 'true'] }] });
    const expected = true;
    const actual = result.results[0]?.exitCode !== undefined;
    expect(actual).toBe(expected);
  });
});

describe('rule config — a key naming a built-in replaces it wholesale', () => {
  it('narrows no-force-push to only match --force (not -f) when replaced', async () => {
    // no-raw-git blocks every git invocation outright, independent of no-force-push — null it out here
    // so this test isolates what it's actually about: does replacing a rule narrow its own matcher.
    const configured = createExecV3(new MemoryFileSystem(), new FakeExecutor(shellLikeResponder()), { buildEnv: (cmdEnv) => ({ ...process.env, ...cmdEnv }) }, new StaticRulesConfigProvider({ 'no-force-push': { argsAnyOf: ['--force'] }, 'no-raw-git': null }));
    const result = await call(configured, { intent: 'test', commands: [{ program: 'git', args: ['push', '-f'] }] });
    const expected = true;
    const actual = result.results[0]?.exitCode !== undefined;
    expect(actual).toBe(expected);
  });
});

describe('rule config — a key not naming a built-in adds a wholly new rule', () => {
  it('refuses a program blocked only by the new rule', async () => {
    const configured = createExecV3(new MemoryFileSystem(), new FakeExecutor(shellLikeResponder()), { buildEnv: (cmdEnv) => ({ ...process.env, ...cmdEnv }) }, new StaticRulesConfigProvider({ 'no-whoami': { programs: ['whoami'], message: 'blocked by config' } }));
    const actual = call(configured, { intent: 'test', commands: [{ program: 'whoami', args: [] }] });
    await expect(actual).rejects.toBeInstanceOf(ToolRefusedError);
  });

  it('names the new rule in the refusal reason', async () => {
    const configured = createExecV3(new MemoryFileSystem(), new FakeExecutor(shellLikeResponder()), { buildEnv: (cmdEnv) => ({ ...process.env, ...cmdEnv }) }, new StaticRulesConfigProvider({ 'no-whoami': { programs: ['whoami'], message: 'blocked by config' } }));
    const actual = call(configured, { intent: 'test', commands: [{ program: 'whoami', args: [] }] });
    await expect(actual).rejects.toThrow('no-whoami');
  });
});
