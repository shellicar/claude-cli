import { createAnthropicAgent } from '@shellicar/claude-sdk';
import { AppLayout } from '../AppLayout.js';
import { logger } from '../logger.js';
import { ReadLine } from '../ReadLine.js';
import { runAgent } from '../runAgent.js';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';

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
