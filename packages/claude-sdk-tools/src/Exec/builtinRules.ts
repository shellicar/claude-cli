import { hasShortFlag } from './hasShortFlag';
import type { ExecRule } from './types';

export const builtinRules: ExecRule[] = [
  {
    name: 'no-destructive-commands',
    check: (commands) => {
      const blocked = new Set(['rm', 'rmdir', 'mkfs', 'dd', 'shred']);
      for (const cmd of commands) {
        if (blocked.has(cmd.program)) {
          return `'${cmd.program}' is destructive and irreversible. Ask the user to run it directly.`;
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-xargs',
    check: (commands) => {
      for (const cmd of commands) {
        if (cmd.program === 'xargs') {
          return 'xargs can execute arbitrary commands on piped input. Write commands explicitly, or use Glob/Grep tools.';
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-sed-in-place',
    check: (commands) => {
      for (const cmd of commands) {
        if (cmd.program === 'sed') {
          if (cmd.args.includes('--in-place') || hasShortFlag(cmd.args, 'i')) {
            return 'sed -i modifies files in-place with no undo. Use the redirect option to write to a new file, or use the Edit tool.';
          }
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-git-rm',
    check: (commands) => {
      for (const cmd of commands) {
        if (cmd.program === 'git' && cmd.args.includes('rm')) {
          return 'git rm is destructive and irreversible. Ask the user to run it directly.';
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-git-checkout',
    check: (commands) => {
      for (const cmd of commands) {
        if (cmd.program === 'git' && cmd.args.includes('checkout')) {
          return 'git checkout can discard uncommitted changes with no undo. Use "git switch" for branches, or ask the user to run it directly.';
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-git-reset',
    check: (commands) => {
      for (const cmd of commands) {
        if (cmd.program === 'git' && cmd.args.includes('reset')) {
          return 'git reset is destructive and irreversible. Ask the user to run it directly.';
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-force-push',
    check: (commands) => {
      for (const cmd of commands) {
        if (cmd.program === 'git' && cmd.args.includes('push')) {
          if (cmd.args.some((a) => a === '-f' || a.startsWith('--force'))) {
            return 'Force push overwrites remote history with no undo. Use regular "git push", or ask the user to run it directly.';
          }
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-exe',
    check: (commands) => {
      for (const cmd of commands) {
        if (cmd.program.endsWith('.exe')) {
          return `'${cmd.program}' — there is no reason to call .exe. Run equivalent commands natively.`;
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-sudo',
    check: (commands) => {
      for (const cmd of commands) {
        if (cmd.program === 'sudo') {
          return 'sudo is not permitted. Run commands directly.';
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-git-C',
    check: (commands) => {
      for (const cmd of commands) {
        if (cmd.program === 'git' && hasShortFlag(cmd.args, 'C')) {
          return 'git -C changes the working directory and bypasses auto-approve path checks. Use cwd instead.';
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-pnpm-C',
    check: (commands) => {
      for (const cmd of commands) {
        if (cmd.program === 'pnpm' && hasShortFlag(cmd.args, 'C')) {
          return 'pnpm -C changes the working directory and bypasses auto-approve path checks. Use cwd instead.';
        }
      }
      return undefined;
    },
  },
  {
    name: 'no-env-dump',
    check: (commands) => {
      const blocked = new Set(['env', 'printenv']);
      for (const cmd of commands) {
        if (blocked.has(cmd.program) && cmd.args.length === 0) {
          return `'${cmd.program}' without arguments would dump all environment variables. Specify which variable to read.`;
        }
      }
      return undefined;
    },
  },
];
