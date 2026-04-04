import { readFileSync, writeFileSync } from 'node:fs';
import { createAnthropicAgent } from '@shellicar/claude-sdk';
import { logger } from './logger';
import { ReadLine } from './ReadLine';
import { runAgent } from './runAgent';

const HISTORY_FILE = '.sdk-history.json';

const main = async () => {
  const apiKey = process.env.CLAUDE_CODE_API_KEY;
  if (!apiKey) {
    logger.error('CLAUDE_CODE_API_KEY is not set');
    process.exit(1);
  }
  using rl = new ReadLine();

  const agent = createAnthropicAgent({ apiKey, logger });

  try {
    const raw = readFileSync(HISTORY_FILE, 'utf-8');
    agent.loadHistory(JSON.parse(raw));
    logger.info('Resumed history from', { file: HISTORY_FILE });
  } catch {
    // No history file, starting fresh
  }

  while (true) {
    const prompt = await rl.question('> ');
    if (!prompt.trim()) continue;
    await runAgent(agent, prompt, rl);
    writeFileSync(HISTORY_FILE, JSON.stringify(agent.getHistory()));
  }
};

main();
