import type { BetaContentBlock, BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import type { HistoryMessage } from '@shellicar/claude-core/history/types';
import { toHistoryBlocks } from './historyBlocks.js';

// The audit line as JSON, read through a widened view. A v2 line carries `turnId`/`queryId`; a v1 (assistant-only,
// pre-migration) line does not — the presence of those ids is the discriminator (write-model §3).
type RawAuditLine = {
  role?: string;
  id?: string;
  turnId?: string;
  queryId?: string;
  timestamp?: string;
  content?: string | BetaContentBlockParam[] | BetaContentBlock[];
};

/**
 * Parse one audit line into a store message, or `null` for a line the ingest ignores. A v1 line (no `turnId`/
 * `queryId`) returns `null` — the migration converts it and a later ingest picks it up. A v2 line is self-contained:
 * its own `id`, `turnId`, `queryId`, `timestamp`, role, and content, so the ingest never reassembles a turn.
 *
 * The line carries no `conversationId` — the session is the audit file's identity, so the caller passes the file's
 * name stem in (write-model §5) and it is stamped onto every message from that file.
 */
export function parseAuditLine(raw: string, conversationId: string): HistoryMessage | null {
  const line = JSON.parse(raw) as RawAuditLine;
  if (line.turnId === undefined || line.queryId === undefined || line.id === undefined || line.timestamp === undefined) {
    return null;
  }
  const role = line.role === 'user' ? 'user' : 'assistant';
  return {
    id: line.id,
    conversationId,
    turnId: line.turnId,
    queryId: line.queryId,
    timestamp: line.timestamp,
    role,
    blocks: toHistoryBlocks(line.content ?? []),
  };
}
