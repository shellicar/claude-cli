import { parseArgs } from 'node:util';
import { AnthropicAuth, createAnthropicAgent } from '@shellicar/claude-sdk';
import { nodeFs } from '@shellicar/claude-sdk-tools/fs';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { AppLayout } from '../AppLayout.js';
import { ClaudeMdLoader } from '../ClaudeMdLoader.js';
import { initConfig } from '../cli-config/initConfig.js';
import { SdkConfigWatcher } from '../cli-config/SdkConfigWatcher.js';
import { GitStateMonitor } from '../GitStateMonitor.js';
import { printUsage, printVersion, printVersionInfo, startupBannerText } from '../help.js';
import { logger } from '../logger.js';
import { ReadLine } from '../ReadLine.js';
import { replayHistory } from '../replayHistory.js';
import { runAgent } from '../runAgent.js';

const { values } = parseArgs({
  options: {
    version: { type: 'boolean', short: 'v', default: false },
    'version-info': { type: 'boolean', default: false },
    'init-config': { type: 'boolean', default: false },
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

if (values['init-config']) {
  // biome-ignore lint/suspicious/noConsole: CLI --init-config output before app starts
  initConfig(console.log);
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

  let turnInProgress = false;
  const watcher = new SdkConfigWatcher((config) => {
    logger.info('config reloaded', { model: config.model });
    // Defer display updates while a turn is running so the model shown matches
    // the model the current API call is actually using. We'll catch up after
    // runAgent returns.
    if (!turnInProgress) {
      layout.setModel(config.model);
    }
  });

  const cleanup = () => {
    watcher.dispose();
    layout.exit();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  rl.setLayout(layout);
  layout.enter();
  const agent = createAnthropicAgent({ authToken, logger, historyFile: HISTORY_FILE });

  if (watcher.config.historyReplay.enabled) {
    const history = agent.getHistory();
    if (history.length > 0) {
      layout.addHistoryBlocks(replayHistory(history, watcher.config.historyReplay));
    }
  }
  layout.showStartupBanner(startupBannerText());
  layout.setModel(watcher.config.model);

  const store = new RefStore();
  const gitMonitor = new GitStateMonitor();
  const claudeMdLoader = new ClaudeMdLoader(nodeFs);
  while (true) {
    const prompt = await layout.waitForInput();
    const gitDelta = await gitMonitor.takeDelta();
    const claudeMdContent = watcher.config.claudeMd.enabled ? await claudeMdLoader.getContent() : null;
    const cachedReminders = claudeMdContent != null ? [claudeMdContent] : undefined;
    turnInProgress = true;
    await runAgent(agent, prompt, layout, store, watcher.config.model, gitDelta ?? undefined, cachedReminders);
    turnInProgress = false;
    layout.setModel(watcher.config.model);
  }
};
await main();
