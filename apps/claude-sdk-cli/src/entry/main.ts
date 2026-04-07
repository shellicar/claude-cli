import { parseArgs } from 'node:util';
import { AnthropicAuth, createAnthropicAgent } from '@shellicar/claude-sdk';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { AppLayout } from '../AppLayout.js';
import { config } from '../cliConfig.js';
import { printUsage, printVersion, printVersionInfo, startupBannerText } from '../help.js';
import { logger } from '../logger.js';
import { ReadLine } from '../ReadLine.js';
import { replayHistory } from '../replayHistory.js';
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
  const auth = new AnthropicAuth({ redirect: 'local' });
  await auth.getCredentials();
  const authToken = async () => {
    const credentials = await auth.getCredentials();
    return credentials.claudeAiOauth.accessToken;
  };

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
  const model = 'claude-sonnet-4-6';
  const agent = createAnthropicAgent({ authToken, logger, historyFile: HISTORY_FILE });

  if (config.historyReplay.enabled) {
    const history = agent.getHistory();
    if (history.length > 0) {
      layout.addHistoryBlocks(replayHistory(history, config.historyReplay));
    }
  }
  layout.showStartupBanner(startupBannerText());
  layout.setModel(model);
  const store = new RefStore();
  while (true) {
    const prompt = await layout.waitForInput();
    await runAgent(agent, prompt, layout, store, model);
  }
};
await main();
