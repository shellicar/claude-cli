import { createAnthropicAgent } from '@shellicar/claude-sdk';
import { logger } from '../logger';
import { ReadLine } from '../ReadLine';
import { runAgent } from '../runAgent';

const HISTORY_FILE = '.sdk-history.jsonl';

const main = async () => {
  process.on('SIGINT', () => {
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    process.exit(0);
  });

  const apiKey = process.env.CLAUDE_CODE_API_KEY;
  if (!apiKey) {
    logger.error('CLAUDE_CODE_API_KEY is not set');
    process.exit(1);
  }
  using rl = new ReadLine();

  const agent = createAnthropicAgent({ apiKey, logger, historyFile: HISTORY_FILE });

  while (true) {
    const prompt = await rl.question('> ');
    if (!prompt.trim()) continue;
    await runAgent(agent, prompt, rl);
  }
};
await main();
