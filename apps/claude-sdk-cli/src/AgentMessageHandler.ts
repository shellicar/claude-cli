import type { SdkMessage } from '@shellicar/claude-sdk';
import type { AppLayout } from './AppLayout.js';
import type { logger } from './logger.js';

/**
 * Handles the stateless SdkMessage cases: routes each message to the
 * appropriate layout call. No accumulated state here.
 *
 * Stateful cases (tool_approval_request, tool_error, message_usage) stay
 * in runAgent.ts until step 4b, when usageBeforeTools tracking and the
 * async tool approval flow move here too.
 *
 * NOTE: message_compaction currently omits the "compacted at X/Y (Z%)"
 * context-usage annotation. That annotation reads lastUsage, which is
 * set by message_usage — a 4b case. The annotation is restored in 4b.
 */
export class AgentMessageHandler {
  #layout: AppLayout;
  #logger: typeof logger;

  public constructor(layout: AppLayout, log: typeof logger) {
    this.#layout = layout;
    this.#logger = log;
  }

  public handle(msg: SdkMessage): void {
    switch (msg.type) {
      case 'query_summary': {
        const parts = [`${msg.systemPrompts} system`, `${msg.userMessages} user`, `${msg.assistantMessages} assistant`, ...(msg.thinkingBlocks > 0 ? [`${msg.thinkingBlocks} thinking`] : [])];
        this.#layout.transitionBlock('meta');
        this.#layout.appendStreaming(parts.join(' · '));
        break;
      }
      case 'message_thinking':
        this.#layout.transitionBlock('thinking');
        this.#layout.appendStreaming(msg.text);
        break;
      case 'message_text':
        this.#layout.transitionBlock('response');
        this.#layout.appendStreaming(msg.text);
        break;
      case 'message_compaction_start':
        this.#layout.transitionBlock('compaction');
        break;
      case 'message_compaction':
        this.#layout.transitionBlock('compaction');
        this.#layout.appendStreaming(msg.summary);
        break;
      case 'done':
        this.#logger.info('done', { stopReason: msg.stopReason });
        if (msg.stopReason !== 'end_turn') {
          this.#layout.appendStreaming(`\n\n[stop: ${msg.stopReason}]`);
        }
        break;
      case 'error':
        this.#layout.transitionBlock('response');
        this.#layout.appendStreaming(`\n\n[error: ${msg.message}]`);
        this.#logger.error('error', { message: msg.message });
        break;
    }
  }
}
