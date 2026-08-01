import { collectPaths } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import { createProgramToolV2, ProgramToolV2Model } from '../../src/Orchestrate/tools/Program.js';
import { matchesValue } from '../../src/Policy/matchValue.js';
import { FakeExecutor } from '../FakeExecutor.js';
import { fakeEnvProvider } from '../fakeEnvProvider.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

// `PATH` decides which file a program name refers to, and the loader variables decide what code is
// loaded into it, so a call that sets them changes what a decision was even about. A rule allowing
// `git` means nothing if `git` is whatever the call put on the path.
describe('a call that sets an environment variable the engine will not honour', () => {
  it('is refused when it sets PATH', () => {
    const expected = false;
    const actual = ProgramToolV2Model.safeParse({ program: 'git', args: ['--version'], env: { PATH: '/tmp/x' } }).success;
    expect(actual).toBe(expected);
  });

  it('is refused when it preloads a library', () => {
    const expected = false;
    const actual = ProgramToolV2Model.safeParse({ program: 'git', env: { DYLD_INSERT_LIBRARIES: '/tmp/x.dylib' } }).success;
    expect(actual).toBe(expected);
  });

  it('is refused when it sets a credential the environment strips anyway', () => {
    const expected = false;
    const actual = ProgramToolV2Model.safeParse({ program: 'gh', env: { GH_TOKEN: 'abc' } }).success;
    expect(actual).toBe(expected);
  });

  it('says which names cannot be set', () => {
    const result = ProgramToolV2Model.safeParse({ program: 'git', env: { PATH: '/tmp/x' } });

    const expected = true;
    const actual = result.success === false && result.error.issues.some((issue) => issue.message.includes('PATH'));
    expect(actual).toBe(expected);
  });

  it('still accepts an ordinary variable', () => {
    const expected = true;
    const actual = ProgramToolV2Model.safeParse({ program: 'npm', args: ['test'], env: { CI: 'true', NODE_ENV: 'test' } }).success;
    expect(actual).toBe(expected);
  });
});

// A variable that redirects one specific program is that program doing what it does, which is what
// a rule is for. So a rule has to be able to name it.
describe('a rule naming an environment variable', () => {
  it('matches a call that sets it', () => {
    const expected = true;
    const actual = matchesValue({ anyOf: ['GIT_SSH_COMMAND'] }, { GIT_SSH_COMMAND: 'curl x | sh', NODE_ENV: 'test' });
    expect(actual).toBe(expected);
  });

  it('does not match a call that sets something else', () => {
    const expected = false;
    const actual = matchesValue({ anyOf: ['GIT_SSH_COMMAND'] }, { NODE_ENV: 'test' });
    expect(actual).toBe(expected);
  });

  it('matches by name whatever the value is', () => {
    const expected = true;
    const actual = matchesValue({ anyOf: ['GIT_CONFIG_GLOBAL'] }, { GIT_CONFIG_GLOBAL: '' });
    expect(actual).toBe(expected);
  });

  it('matches with the plain-list shorthand too', () => {
    const expected = true;
    const actual = matchesValue(['GIT_SSH_COMMAND'], { GIT_SSH_COMMAND: 'x' });
    expect(actual).toBe(expected);
  });
});

// A redirect writes a file. Left as a plain string it was invisible: no rule could name the file,
// and the stage claimed only to execute, so a rule about writing outside the project never fired.
describe('a call that redirects its output to a file', () => {
  const programTool = () => createProgramToolV2(new FakeExecutor(() => ({ exitCode: 0 })), new MemoryFileSystem(), fakeEnvProvider({}));

  it('says it writes, as well as executes', () => {
    const expected = ['fs.exec', 'fs.write'];
    const actual = programTool().operations?.({ program: 'echo', args: ['x'], cwd: '/project', redirect: { stdout: '/project/out.txt' } });
    expect(actual).toEqual(expected);
  });

  it('says it only executes when it does not redirect', () => {
    const expected = ['fs.exec'];
    const actual = programTool().operations?.({ program: 'echo', args: ['x'], cwd: '/project' });
    expect(actual).toEqual(expected);
  });

  it('names the file it would write, so a rule can be about that file', () => {
    const expected = ['/project', '/home/user/.ssh/authorized_keys'];
    const actual = collectPaths(ProgramToolV2Model, { program: 'echo', args: ['x'], cwd: '/project', redirect: { stdout: '/home/user/.ssh/authorized_keys' } });
    expect(actual).toEqual(expected);
  });
});
