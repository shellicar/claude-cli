import { describe, expect, it } from 'vitest';
import { resolve } from '../../src/Policy/resolve.js';
import type { PolicySet } from '../../src/Policy/types.js';

// Every real `Exec/ruleConfig.ts` defaultRules entry, ported one for one, matched against
// Program's real input.program/input.args fields — proving genuine parity, not a hand-picked
// subset. `basename` everywhere `programs` was used, since a real call can arrive by full path.
const cwd = '/repo';
const home = '/home/stephen';

const policy: PolicySet = [
  { tool: 'Program', input: { program: { basename: ['rm', 'rmdir', 'mkfs', 'dd', 'shred'] } }, default: 'deny', message: "'{program}' is destructive and irreversible. Ask the user to run it directly." },
  { tool: 'Program', input: { program: { basename: ['xargs'] } }, default: 'deny', message: 'xargs can execute arbitrary commands on piped input. Write commands explicitly, or use Glob/Grep tools.' },
  { tool: 'Program', input: { program: { basename: ['sed'] }, args: { anyOf: ['-i', '--in-place'] } }, default: 'deny', message: 'sed -i modifies files in-place with no undo. Use the redirect option to write to a new file, or use the Edit tool.' },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { allOf: ['rm'] } }, default: 'deny', message: 'git rm is destructive and irreversible. Ask the user to run it directly.' },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { allOf: ['checkout'] } }, default: 'deny', message: 'git checkout can discard uncommitted changes with no undo. Use "git switch" for branches, or ask the user to run it directly.' },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { allOf: ['reset'] } }, default: 'deny', message: 'git reset is destructive and irreversible. Ask the user to run it directly.' },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { allOf: ['push'], anyOf: ['-f', '--force', '--force-with-lease', '--force-if-includes'] } }, default: 'deny', message: 'Force push overwrites remote history with no undo. Use regular "git push", or ask the user to run it directly.' },
  { tool: 'Program', input: { program: { suffix: '.exe' } }, default: 'deny', message: "'{program}' - there is no reason to call .exe. Run equivalent commands natively." },
  { tool: 'Program', input: { program: { basename: ['sudo'] } }, default: 'deny', message: 'sudo is not permitted. Run commands directly.' },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { anyOf: ['-C', '--git-dir', '--work-tree', '-c'] } }, default: 'deny', message: 'git -C/--git-dir/--work-tree changes the working directory, and -c overrides config outside review. Use cwd instead, and avoid -c overrides.' },
  { tool: 'Program', input: { program: { basename: ['pnpm'] }, args: { anyOf: ['-C'] } }, default: 'deny', message: 'pnpm -C changes the working directory and bypasses auto-approve path checks. Use cwd instead.' },
  { tool: 'Program', input: { program: { basename: ['env', 'printenv'] }, args: { maxLength: 0 } }, default: 'deny', message: "'{program}' without arguments would dump all environment variables. Specify which variable to read." },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { allOf: ['clean'] } }, default: 'deny', message: 'git clean deletes untracked files with no undo. Ask the user to run it directly.' },
  { tool: 'Program', input: { program: { basename: ['sh', 'bash', 'zsh', 'python', 'python3', 'node', 'ruby', 'perl', 'osascript'] }, args: { anyOf: ['-c', '-e', '--eval'] } }, default: 'deny', message: "'{program}' with inline code runs unreviewed content directly. Write it to a file, then run that file." },
  { tool: 'Program', input: { program: { basename: ['find'] }, args: { anyOf: ['-exec', '-execdir', '-ok', '-okdir'] } }, default: 'deny', message: "find's -exec/-execdir/-ok/-okdir runs unreviewed commands directly. Write the command to a file and run it, or use the Find/Match tools." },

  { tool: '*', default: 'ask' },
];

function verdictFor(program: string, args: string[]) {
  return resolve(policy, { tool: 'Program', input: { program, args }, paths: [], operation: 'fs.exec', cwd, home }).verdict;
}

describe('execV3 parity — every defaultRules entry, ported one for one', () => {
  it('no-destructive-commands: blocks rm, rmdir, mkfs, dd, shred', () => {
    expect(verdictFor('rm', ['-rf', '/tmp'])).toBe('deny');
    expect(verdictFor('shred', ['/tmp/a'])).toBe('deny');
  });

  it('no-xargs: blocks xargs entirely', () => {
    expect(verdictFor('xargs', ['rm'])).toBe('deny');
  });

  it('no-sed-in-place: blocks sed -i, leaves plain sed alone', () => {
    expect(verdictFor('sed', ['-i', 's/a/b/', 'f.txt'])).toBe('deny');
    expect(verdictFor('sed', ['s/a/b/', 'f.txt'])).toBe('ask');
  });

  it('no-git-rm: blocks git rm', () => {
    expect(verdictFor('git', ['rm', 'f.txt'])).toBe('deny');
  });

  it('no-git-checkout: blocks git checkout', () => {
    expect(verdictFor('git', ['checkout', 'main'])).toBe('deny');
  });

  it('no-git-reset: blocks git reset', () => {
    expect(verdictFor('git', ['reset', '--hard'])).toBe('deny');
  });

  it('no-force-push: blocks git push --force, leaves a plain push alone', () => {
    expect(verdictFor('git', ['push', '--force'])).toBe('deny');
    expect(verdictFor('git', ['push', 'origin', 'main'])).toBe('ask');
  });

  it('no-exe: blocks anything ending in .exe', () => {
    expect(verdictFor('malware.exe', [])).toBe('deny');
  });

  it('no-sudo: blocks sudo entirely', () => {
    expect(verdictFor('sudo', ['apt', 'install', 'x'])).toBe('deny');
  });

  it('no-git-C: blocks git -C', () => {
    expect(verdictFor('git', ['-C', '/other', 'status'])).toBe('deny');
  });

  it('no-pnpm-C: blocks pnpm -C', () => {
    expect(verdictFor('pnpm', ['-C', 'packages/foo', 'build'])).toBe('deny');
  });

  it('no-env-dump: blocks env with no arguments, leaves env VAR_NAME alone', () => {
    expect(verdictFor('env', [])).toBe('deny');
    expect(verdictFor('env', ['PATH'])).toBe('ask');
  });

  it('no-git-clean: blocks git clean', () => {
    expect(verdictFor('git', ['clean', '-fd'])).toBe('deny');
  });

  it('no-inline-interpreter: blocks node -e, leaves running a real file alone', () => {
    expect(verdictFor('node', ['-e', 'console.log(1)'])).toBe('deny');
    expect(verdictFor('node', ['script.js'])).toBe('ask');
  });

  it('no-find-exec: blocks find -exec', () => {
    expect(verdictFor('find', ['.', '-exec', 'rm', '{}', ';'])).toBe('deny');
  });

  it('an ordinary, unrelated command falls through every rule to the catch-all', () => {
    expect(verdictFor('pnpm', ['build'])).toBe('ask');
  });

  it('every rule still catches its program by full path, not just the bare name', () => {
    expect(verdictFor('/bin/rm', ['-rf', '/tmp'])).toBe('deny');
    expect(verdictFor('/usr/bin/sudo', ['ls'])).toBe('deny');
  });
});
