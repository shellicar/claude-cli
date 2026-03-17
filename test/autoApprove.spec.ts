import { describe, expect, it } from 'vitest';
import { isExecAutoApproved } from '../src/mcp/shellicar/autoApprove';

const HOME = process.env.HOME ?? '/home/testuser';

describe('isExecAutoApproved', () => {
  describe('basic matching', () => {
    it('matches exact absolute path', () => {
      const result = isExecAutoApproved(
        { steps: [{ type: 'command', program: '/usr/bin/git' }] },
        ['/usr/bin/git'],
        '/tmp',
      );
      expect(result).toBe(true);
    });

    it('rejects when no patterns match', () => {
      const result = isExecAutoApproved(
        { steps: [{ type: 'command', program: '/usr/bin/curl' }] },
        ['/usr/bin/git'],
        '/tmp',
      );
      expect(result).toBe(false);
    });

    it('returns false with empty patterns', () => {
      const result = isExecAutoApproved(
        { steps: [{ type: 'command', program: 'git' }] },
        [],
        '/tmp',
      );
      expect(result).toBe(false);
    });

    it('returns false with empty steps', () => {
      const result = isExecAutoApproved(
        { steps: [] },
        ['/usr/bin/*'],
        '/tmp',
      );
      expect(result).toBe(false);
    });
  });

  describe('path resolution', () => {
    it('resolves relative program against default cwd', () => {
      const result = isExecAutoApproved(
        { steps: [{ type: 'command', program: './scripts/build.sh' }] },
        ['/home/user/project/scripts/build.sh'],
        '/home/user/project',
      );
      expect(result).toBe(true);
    });

    it('resolves relative program against step cwd', () => {
      const result = isExecAutoApproved(
        { steps: [{ type: 'command', program: './build.sh', cwd: '/home/user/project/scripts' }] },
        ['/home/user/project/scripts/build.sh'],
        '/tmp',
      );
      expect(result).toBe(true);
    });
  });

  describe('$HOME expansion', () => {
    it('expands $HOME in patterns', () => {
      const result = isExecAutoApproved(
        { steps: [{ type: 'command', program: `${HOME}/.claude/skills/git-commit/scripts/info.sh` }] },
        ['$HOME/.claude/skills/*/scripts/*.sh'],
        '/tmp',
      );
      expect(result).toBe(true);
    });

    it('expands ~ in patterns', () => {
      const result = isExecAutoApproved(
        { steps: [{ type: 'command', program: `${HOME}/.claude/skills/git-commit/scripts/info.sh` }] },
        ['~/.claude/skills/*/scripts/*.sh'],
        '/tmp',
      );
      expect(result).toBe(true);
    });
  });

  describe('glob patterns', () => {
    it('matches wildcard in directory', () => {
      const result = isExecAutoApproved(
        { steps: [{ type: 'command', program: `${HOME}/.claude/skills/any-skill/scripts/run.sh` }] },
        [`${HOME}/.claude/skills/*/scripts/*.sh`],
        '/tmp',
      );
      expect(result).toBe(true);
    });

    it('does not match deeper nesting than pattern allows', () => {
      const result = isExecAutoApproved(
        { steps: [{ type: 'command', program: `${HOME}/.claude/skills/a/b/scripts/run.sh` }] },
        [`${HOME}/.claude/skills/*/scripts/*.sh`],
        '/tmp',
      );
      expect(result).toBe(false);
    });

    it('matches ** for deep nesting', () => {
      const result = isExecAutoApproved(
        { steps: [{ type: 'command', program: `${HOME}/.claude/skills/a/b/scripts/run.sh` }] },
        [`${HOME}/.claude/skills/**/scripts/*.sh`],
        '/tmp',
      );
      expect(result).toBe(true);
    });
  });

  describe('multi-step', () => {
    it('approves only if ALL steps match', () => {
      const result = isExecAutoApproved(
        {
          steps: [
            { type: 'command', program: '/usr/bin/git' },
            { type: 'command', program: '/usr/bin/curl' },
          ],
        },
        ['/usr/bin/git'],
        '/tmp',
      );
      expect(result).toBe(false);
    });

    it('approves when all steps match', () => {
      const result = isExecAutoApproved(
        {
          steps: [
            { type: 'command', program: '/usr/bin/git' },
            { type: 'command', program: '/usr/bin/node' },
          ],
        },
        ['/usr/bin/*'],
        '/tmp',
      );
      expect(result).toBe(true);
    });
  });

  describe('pipelines', () => {
    it('checks all commands in a pipeline', () => {
      const result = isExecAutoApproved(
        {
          steps: [{
            type: 'pipeline',
            commands: [
              { program: '/usr/bin/grep' },
              { program: '/usr/bin/wc' },
            ],
          }],
        },
        ['/usr/bin/*'],
        '/tmp',
      );
      expect(result).toBe(true);
    });

    it('rejects pipeline if any command fails to match', () => {
      const result = isExecAutoApproved(
        {
          steps: [{
            type: 'pipeline',
            commands: [
              { program: '/usr/bin/grep' },
              { program: '/usr/local/bin/evil' },
            ],
          }],
        },
        ['/usr/bin/*'],
        '/tmp',
      );
      expect(result).toBe(false);
    });
  });

  describe('multiple patterns', () => {
    it('matches if any pattern matches', () => {
      const result = isExecAutoApproved(
        { steps: [{ type: 'command', program: '/usr/local/bin/node' }] },
        ['/usr/bin/*', '/usr/local/bin/*'],
        '/tmp',
      );
      expect(result).toBe(true);
    });
  });
});
