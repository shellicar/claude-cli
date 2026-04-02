import { AnthropicAgent } from '@shellicar/claude-sdk';
import { ToolDefinition } from '../../../packages/claude-sdk/src/public/types';
import { z } from 'zod';
import { logger } from './logger';

const dateTool: ToolDefinition = {
  description: 'Get the current date and time',
  handler: () => new Date().toISOString(),
  input_schema: z.never(),
  name: 'get_time',
};

const main = async () => {
  const agent = new AnthropicAgent({
    apiKey: process.env.CLAUDE_CODE_API_KEY!,
    logger,
  });

  agent.on('message_start', () => process.stdout.write('> '));
  agent.on('message_text', (x) => process.stdout.write(x));
  agent.on('message_end', () => console.log());

  await agent.runAgent({
    model: 'claude-sonnet-4-6',
    messages: ['can you tell me the time, please?'],
    tools: [dateTool],
  });
};
main();
