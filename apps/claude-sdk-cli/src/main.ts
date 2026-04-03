import { createAnthropicAgent } from '@shellicar/claude-sdk';
import { logger } from './logger';
import { ReadLine } from './ReadLine';
import { runAgent } from './runAgent';

const main = async () => {
  const apiKey = process.env.CLAUDE_CODE_API_KEY;
  if (!apiKey) {
    logger.error('CLAUDE_CODE_API_KEY is not set');
    process.exit(1);
  }
  using rl = new ReadLine();

  const agent = createAnthropicAgent({ apiKey, logger });

  while (true) {
    const prompt = await rl.question('> ');
    if (!prompt.trim()) continue;
    await runAgent(agent, prompt);
  }
};

main();
