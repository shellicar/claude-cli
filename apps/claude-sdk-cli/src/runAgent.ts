import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaImageBlockParam, BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { IQueryRunner, QueryOutcome, Sender, SystemReminder, TransformToolResult } from '@shellicar/claude-sdk';
import { logger } from './logger.js';
import type { ImageAttachment } from './model/CommandModeState.js';
import type { IConversationState } from './model/ConversationState.js';
import type { IEditorBuffer } from './model/EditorBuffer.js';
import type { IPrimaryViewState } from './model/PrimaryViewState.js';
import type { IToolApprovalState } from './model/ToolApprovalState.js';

export type UserInput = {
  text: string;
  images: ImageAttachment[];
  /** True for an empty submit that resumes an interrupted turn (the conversation
   * already ends on an unanswered user message). No new user message is sent. */
  resume?: boolean;
  /** Present when this input came from an accepted wire `say`: the queryId already returned in the
   *  `accepted` reply, and the sender to echo as `from`. Absent for keyboard input. */
  queryId?: string;
  from?: Sender;
};

export type RunAgentInput = {
  displayText: string;
  /** null on resume: nothing new to send; QueryRunner re-issues the existing
   * trailing user message. */
  message: Anthropic.Beta.Messages.BetaMessageParam | null;
  /** Carried through from an accepted wire `say` so the committed user message gets that queryId/from. */
  queryId?: string;
  from?: Sender;
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
  if (userInput.resume) {
    return { displayText: '', message: null, queryId: userInput.queryId, from: userInput.from };
  }
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

  return { displayText, message: { role: 'user', content: contentBlocks }, queryId: userInput.queryId, from: userInput.from };
}

const INTERRUPTED = '\u23f9\ufe0f Interrupted by user';

export type RunAgentStores = {
  conversationState: IConversationState;
  toolApprovalState: IToolApprovalState;
  editorBuffer: IEditorBuffer;
  primaryViewState: IPrimaryViewState;
};

/** The turn's reminders, named rather than positional: several are `string | null` and adjacent, so
 *  a transposed pair would compile clean and mislabel two reminders. */
export type TurnReminders = {
  git?: string;
  skill?: string | null;
  cwd?: string | null;
};

export async function runAgent(queryRunner: IQueryRunner, input: RunAgentInput, stores: RunAgentStores, transformToolResult: TransformToolResult, abortController: AbortController, deltas: TurnReminders = {}): Promise<QueryOutcome> {
  const { conversationState, toolApprovalState, editorBuffer, primaryViewState } = stores;

  // Where this turn's transcript starts, so a rolled-back query can be taken off the screen as well
  // as out of the conversation. Read before the prompt block opens.
  const transcriptMark = conversationState.sealedBlocks.length;

  // On resume there is no new user message: don't open a prompt block.
  if (input.message !== null) {
    conversationState.transitionBlock('prompt');
    conversationState.appendToActive(input.displayText);
    conversationState.completeActive();
  }
  primaryViewState.setPhase('streaming');

  // The skill and cwd deltas are persisted-leading (frozen in history, cached); the git delta is
  // ephemeral-trailing (re-added per turn, uncached).
  const reminders: SystemReminder[] = [];
  if (deltas.skill) {
    reminders.push({ text: deltas.skill, persisted: true, position: 'leading' });
  }
  if (deltas.cwd) {
    reminders.push({ text: deltas.cwd, persisted: true, position: 'leading' });
  }
  if (deltas.git) {
    reminders.push({ text: deltas.git, persisted: false, position: 'trailing' });
  }

  let outcome: QueryOutcome = { interrupted: false, rolledBack: false };
  try {
    outcome = await queryRunner.run({
      messages: input.message !== null ? [input.message] : [],
      reminders: reminders.length > 0 ? reminders : undefined,
      transformToolResult,
      abortController,
      queryId: input.queryId,
      from: input.from,
    });
    if (outcome.rolledBack) {
      // The query committed nothing and has been taken back out of the conversation, so take it off
      // the screen too: leaving the ask and its interrupt line up would show an exchange that no
      // longer exists anywhere, above an editor holding that same ask back for another go.
      conversationState.truncateTo(transcriptMark);
    } else if (outcome.interrupted) {
      // Seal whatever streamed before the cancel, then say so beneath it. Without the line the
      // transcript shows a reply that simply stops, which reads as one Claude chose to end.
      conversationState.completeActive();
      conversationState.spliceNotice(INTERRUPTED);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    conversationState.appendStreaming(`\n\n[error: ${message}]`);
    logger.error('runAgent error', { message });
  } finally {
    // Was layout.completeStreaming():
    conversationState.completeActive();
    toolApprovalState.clearTools();
    toolApprovalState.resetExpanded();
    editorBuffer.reset();
    primaryViewState.setPhase('editor');
  }
  return outcome;
}
