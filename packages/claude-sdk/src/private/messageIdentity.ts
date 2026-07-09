import { randomUUID } from 'node:crypto';
import type { MessageIdentity, Sender } from './Conversation';

/**
 * The three ids are minted at one site each (the locked id model): a round's user-role message mints
 * `turnId` + `messageId` together; the assistant message mints its own `messageId` and inherits the
 * round's `turnId`/`queryId`. `queryId` is minted once per query in `QueryRunner.run` and threaded in.
 * Pure functions, not an injected service — minting needs no state held across calls beyond the queryId,
 * which is a `run` local, and "current" is read off the conversation tip.
 */

/** The round's user-role message: mint turnId + messageId together, carry the query's id and sender. */
export const userIdentity = (queryId: string, from: Sender): MessageIdentity => ({ messageId: randomUUID(), turnId: randomUUID(), queryId, from });

/** The assistant message: mint its own messageId, inherit the round's turnId + queryId, from = agent. */
export const assistantIdentity = (round: MessageIdentity): MessageIdentity => ({ messageId: randomUUID(), turnId: round.turnId, queryId: round.queryId, from: { kind: 'agent' } });
