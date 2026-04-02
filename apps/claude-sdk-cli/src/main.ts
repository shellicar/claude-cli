import { AnthropicAgent, AnthropicBeta } from '@shellicar/claude-sdk';
import { logger } from './logger';
import { editConfirmTool } from './tools/edit/editConfirmTool';
import { editTool } from './tools/edit/editTool';

const main = async () => {
  const agent = new AnthropicAgent({
    apiKey: process.env.CLAUDE_CODE_API_KEY ?? 'no-key',
    logger,
  });

  agent.on('message_start', () => process.stdout.write('> '));
  agent.on('message_text', (x) => process.stdout.write(x));
  agent.on('message_end', () => process.stdout.write('\n'));

  await agent.runAgent({
    model: 'claude-sonnet-4-6',
    maxTokens: 8096,
    messages: ['Please add a comment "// hello world" on line 1344 of the file /Users/stephen/repos/@shellicar/claude-cli/node_modules/.pnpm/@anthropic-ai+sdk@0.80.0_zod@4.3.6/node_modules/@anthropic-ai/sdk/src/resources/messages/messages.ts'],
    tools: [editTool, editConfirmTool],
    betas: {
      [AnthropicBeta.InterleavedThinking]: true,
      [AnthropicBeta.ContextManagement]: true,
      [AnthropicBeta.PromptCachingScope]: true,
      [AnthropicBeta.Effort]: true,
      [AnthropicBeta.AdvancedToolUse]: true,
      [AnthropicBeta.TokenEfficientTools]: true,
    },
  });
};
main();
