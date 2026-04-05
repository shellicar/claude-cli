import { parseArgs } from 'node:util';
import { createAnthropicAgent } from '@shellicar/claude-sdk';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { AppLayout } from '../AppLayout.js';
import { printUsage, printVersion, printVersionInfo } from '../help.js';
import { logger } from '../logger.js';
import { ReadLine } from '../ReadLine.js';
import { runAgent } from '../runAgent.js';

const { values } = parseArgs({
  options: {
    version: { type: 'boolean', short: 'v', default: false },
    'version-info': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: false,
});

if (values.version) {
  // biome-ignore lint/suspicious/noConsole: CLI --version output before app starts
  printVersion(console.log);
  process.exit(0);
}

if (values['version-info']) {
  // biome-ignore lint/suspicious/noConsole: CLI --version-info output before app starts
  printVersionInfo(console.log);
  process.exit(0);
}

if (values.help || process.argv.includes('-?')) {
  // biome-ignore lint/suspicious/noConsole: CLI --help output before app starts
  printUsage(console.log);
  process.exit(0);
}

if (!process.stdin.isTTY) {
  process.stderr.write('stdin is not a terminal. Run interactively.\n');
  process.exit(1);
}

const HISTORY_FILE = '.sdk-history.jsonl';

const main = async () => {
  const apiKey = process.env.CLAUDE_CODE_API_KEY;
  if (!apiKey) {
    logger.error('CLAUDE_CODE_API_KEY is not set');
    process.exit(1);
  }

  using rl = new ReadLine();
  const layout = new AppLayout();

  const cleanup = () => {
    layout.exit();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  rl.setLayout(layout);
  layout.enter();

  const agent = createAnthropicAgent({ apiKey, logger, historyFile: HISTORY_FILE });
  const store = new RefStore();
  while (true) {
    const prompt = await layout.waitForInput();
    await runAgent(agent, prompt, layout, store);
  }
};
await main();
