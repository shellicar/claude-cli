/**
 * Run directly with tsx in a raw kitty terminal (no tmux, no VS Code) to inspect
 * exactly what escape sequences your terminal sends for each key combination.
 *
 * Usage:
 *   tsx scripts/keydump.ts
 *
 * Press keys to see their raw sequences. Ctrl+C to exit.
 */
import readline from 'node:readline';

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

process.stdin.on('keypress', (ch: string | undefined, key: { sequence?: string; name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean } | undefined) => {
  const raw = key?.sequence ?? ch ?? '';
  const hex = [...raw].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
  const line = [
    `hex: ${hex.padEnd(20)}`,
    `json: ${JSON.stringify(raw).padEnd(20)}`,
    `name=${String(key?.name).padEnd(12)}`,
    `ctrl=${key?.ctrl}`.padEnd(10),
    `meta=${key?.meta}`.padEnd(10),
    `shift=${key?.shift}`,
  ].join('  ');
  process.stdout.write(line + '\n');
  if (key?.ctrl && key?.name === 'c') process.exit(0);
});

process.stdout.write('Key inspector ready — press keys, Ctrl+C to exit\n\n');
