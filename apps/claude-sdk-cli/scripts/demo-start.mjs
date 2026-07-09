// Demonstration start: put a known participant on a pane. Opens a fresh tmux window running the
// built CLI with the NATS participant enabled, resuming conversation <conversationId>, so there is
// an addressable CLI on the wire for `demo-send` to speak to.
//
//   node scripts/demo-start.mjs <conversationId>
//
// The CLI parses --config as a JSON override (main.ts) and --resume takes the conversation UUID, so
// nats is enabled without editing any config file on disk.
import { spawnSync } from 'node:child_process';

const conv = process.argv[2];
if (!conv) {
  process.stderr.write('usage: demo-start.mjs <conversationId>\n');
  process.exit(1);
}

const cmd = `node dist/main.js --resume ${conv} --config '{"nats":{"enabled":true}}'`;
const result = spawnSync('tmux', ['new-window', '-n', `cli-${conv.slice(0, 8)}`, cmd], { stdio: 'inherit' });
process.exit(result.status ?? 0);
