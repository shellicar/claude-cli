import type { MessagePort } from 'node:worker_threads';
import type { QueryRunner, TransformToolResult } from '@shellicar/claude-sdk';
import type { AppLayout } from './AppLayout.js';
import { logger } from './logger.js';

export async function runAgent(queryRunner: QueryRunner, prompt: string, layout: AppLayout, consumerPort: MessagePort, transformToolResult: TransformToolResult, abortController: AbortController, gitDelta?: string): Promise<void> {
  layout.startStreaming(prompt);
  layout.setCancelFn(() => consumerPort.postMessage({ type: 'cancel' }));

  try {
    await queryRunner.run({
      messages: [prompt],
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
