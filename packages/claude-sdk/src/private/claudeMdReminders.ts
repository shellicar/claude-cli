import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta.mjs';
import { isSystemReminderBlock } from './RequestBuilder';

/**
 * Format cached reminder strings as `<system-reminder>` text blocks. The last
 * block carries a trailing blank line so the reminder run is visually separated
 * from the user's own text that follows it. Single source of the wrapper shape
 * so the query runner's history injection and the turn runner's per-request
 * re-injection stay identical (the CLAUDE.md prefix cache marker keys off this
 * shape).
 */
export function buildReminderBlocks(reminders: string[]): BetaTextBlockParam[] {
  return reminders.map((text, i, arr) => ({
    type: 'text' as const,
    text: `<system-reminder>\n${text}\n</system-reminder>\n${i === arr.length - 1 ? '\n' : ''}`,
  }));
}

/**
 * Ensure the cached CLAUDE.md reminders lead the first user message of a
 * caller-owned request clone, injecting them when they are absent.
 *
 * The query runner injects the reminders into the first user message of stored
 * history, so a fresh conversation already carries them and this is a no-op.
 * After a compaction, `Conversation.cloneForRequest` returns the post-compaction
 * slice, whose first user message is a later turn that never held the reminders
 * — so without this they silently leave the model's context on every turn past
 * the first compaction. The reminders are held config, not conversation history,
 * so re-injecting them here keeps them present in every request.
 *
 * Idempotent: if the first user message already leads with a `<system-reminder>`
 * block the reminders are present and it does nothing, so it never doubles them
 * up on the pre-compaction path.
 */
export function ensureClaudeMdReminders(messages: Anthropic.Beta.Messages.BetaMessageParam[], reminders: string[] | undefined): void {
  if (reminders == null || reminders.length === 0) {
    return;
  }

  const idx = messages.findIndex((m) => m.role === 'user');
  if (idx === -1) {
    return;
  }

  const msg = messages[idx];
  if (msg == null) {
    return;
  }

  const content = typeof msg.content === 'string' ? [{ type: 'text' as const, text: msg.content }] : msg.content;
  const first = content[0];
  if (first != null && first.type === 'text' && isSystemReminderBlock(first.text)) {
    return;
  }

  msg.content = [...buildReminderBlocks(reminders), ...content];
}
