import type { PolicySet } from './types.js';

/** The shipped default \u2014 a config file that never sets `policy` behaves exactly like today's
 *  four separate mechanisms combined: ExecV3's `defaultRules` (Exec/ruleConfig.ts), the
 *  `permissions` default/outside zone grid, and the Memory tools' frictionless carve-out.
 *  Proven equivalent in packages/claude-sdk-tools/test/Policy/execV3Parity.spec.ts and
 *  policy.integration.spec.ts \u2014 this is that same list, not a re-derivation of it. */
export const defaultPolicy: PolicySet = [
  { tool: ['WriteMemory', 'ReadMemory', 'SearchMemory', 'DeleteMemory', 'MemoryTypes'], default: 'allow' },

  { tool: 'Program', input: { program: { basename: ['rm', 'rmdir', 'mkfs', 'dd', 'shred'] } }, default: 'deny', message: "'{program}' is destructive and irreversible. Ask the user to run it directly." },
  { tool: 'Program', input: { program: { basename: ['xargs'] } }, default: 'deny', message: 'xargs can execute arbitrary commands on piped input. Write commands explicitly, or use Find/Match instead.' },
  { tool: 'Program', input: { program: { basename: ['sed'] }, args: { anyOf: ['-i', '--in-place'] } }, default: 'deny', message: 'sed -i modifies files in-place with no undo. Use the redirect option to write to a new file, or use the Edit tool.' },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { allOf: ['rm'] } }, default: 'deny', message: 'git rm is destructive and irreversible. Ask the user to run it directly.' },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { allOf: ['checkout'] } }, default: 'deny', message: 'git checkout can discard uncommitted changes with no undo. Use "git switch" for branches, or ask the user to run it directly.' },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { allOf: ['reset'] } }, default: 'deny', message: 'git reset is destructive and irreversible. Ask the user to run it directly.' },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { allOf: ['push'], anyOf: ['-f', '--force', '--force-with-lease', '--force-if-includes'] } }, default: 'deny', message: 'Force push overwrites remote history with no undo. Use regular "git push", or ask the user to run it directly.' },
  { tool: 'Program', input: { program: { suffix: '.exe' } }, default: 'deny', message: "'{program}' \u2014 there is no reason to call .exe. Run equivalent commands natively." },
  { tool: 'Program', input: { program: { basename: ['sudo'] } }, default: 'deny', message: 'sudo is not permitted. Run commands directly.' },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { anyOf: ['-C', '--git-dir', '--work-tree', '-c'] } }, default: 'deny', message: 'git -C/--git-dir/--work-tree changes the working directory, and -c overrides config outside review. Use cwd instead, and avoid -c overrides.' },
  { tool: 'Program', input: { program: { basename: ['pnpm'] }, args: { anyOf: ['-C'] } }, default: 'deny', message: 'pnpm -C changes the working directory and bypasses auto-approve path checks. Use cwd instead.' },
  { tool: 'Program', input: { program: { basename: ['env', 'printenv'] }, args: { maxLength: 0 } }, default: 'deny', message: "'{program}' without arguments would dump all environment variables. Specify which variable to read." },
  { tool: 'Program', input: { program: { basename: ['git'] }, args: { allOf: ['clean'] } }, default: 'deny', message: 'git clean deletes untracked files with no undo. Ask the user to run it directly.' },
  {
    tool: 'Program',
    input: { program: { basename: ['sh', 'bash', 'zsh', 'python', 'python3', 'node', 'ruby', 'perl', 'osascript'] }, args: { anyOf: ['-c', '-e', '--eval'] } },
    default: 'deny',
    message: "'{program}' with inline code ('-c'/'-e'/'--eval') runs unreviewed content directly. Write it to a file, then run that file.",
  },
  { tool: 'Program', input: { program: { basename: ['find'] }, args: { anyOf: ['-exec', '-execdir', '-ok', '-okdir'] } }, default: 'deny', message: "find's -exec/-execdir/-ok/-okdir runs unreviewed commands directly. Write the command to a file and run it, or use the Find/Match tools." },

  { path: '~/.ssh/**', default: 'deny' },
  { path: '$PWD', operations: { 'fs.read': 'allow', 'fs.list': 'allow', 'fs.write': 'ask', 'fs.delete': 'ask', 'fs.exec': 'ask' } },
  { path: '*', operations: { 'fs.read': 'allow', 'fs.list': 'allow', 'fs.write': 'ask', 'fs.delete': 'deny', 'fs.exec': 'ask' } },

  { tool: '*', default: 'ask' },
];
