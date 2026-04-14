import type { MessagePort } from 'node:worker_threads';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaImageBlockParam, BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { QueryRunner, TransformToolResult } from '@shellicar/claude-sdk';
import type { AppLayout, UserInput } from './AppLayout.js';
import { logger } from './logger.js';

export type RunAgentInput = {
  displayText: string;
  message: Anthropic.Beta.Messages.BetaMessageParam;
};

/**
 * Build the RunAgentInput from a UserInput.
 *
 * When images are present, constructs a multi-content BetaMessageParam with
 * image blocks (and a text block if text is non-empty). The display text
 * appends an image summary so the prompt block shows what was sent.
 *
 * When no images are present, wraps the text in a single-block BetaMessageParam.
 */
export function buildRunAgentInput(userInput: UserInput): RunAgentInput {
  const contentBlocks: (BetaImageBlockParam | BetaTextBlockParam)[] = [];
  let displayText = userInput.text;

  for (const img of userInput.images) {
    contentBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    });
  }

  if (userInput.text) {
    contentBlocks.push({ type: 'text', text: userInput.text });
  }

  if (userInput.images.length > 0) {
    const imgSummary = userInput.images
      .map((img) => {
        const sz = img.sizeBytes >= 1024 ? `${(img.sizeBytes / 1024).toFixed(1)}KB` : `${img.sizeBytes}B`;
        return `[image ${img.mediaType} ${sz}]`;
      })
      .join(' ');
    displayText = displayText ? `${displayText}\n${imgSummary}` : imgSummary;
  }

  return { displayText, message: { role: 'user', content: contentBlocks } };
}

export async function runAgent(queryRunner: QueryRunner, input: RunAgentInput, layout: AppLayout, consumerPort: MessagePort, transformToolResult: TransformToolResult, abortController: AbortController, gitDelta?: string): Promise<void> {
  layout.startStreaming(input.displayText);
  layout.setCancelFn(() => consumerPort.postMessage({ type: 'cancel' }));

  try {
    await queryRunner.run({
      messages: [input.message],
      systemReminder: gitDelta,
      transformToolResult,
      abortController,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    layout.transitionBlock('response');
    layout.appendStreaming(`\n\n[error: ${message}]`);
    logger.error('runAgent error', { message });
  } finally {
    layout.setCancelFn(null);
    layout.completeStreaming();
  }
}
