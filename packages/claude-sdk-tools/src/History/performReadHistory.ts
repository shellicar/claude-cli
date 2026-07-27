import type { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import type { ReadHistoryInput, ReadHistoryOutput } from './types.js';

type EventType = ReadHistoryOutput[number]['events'][number]['type'];

/** Shared between V1's `ReadHistory` and V2's — the citation mapping and output shaping is real
 *  logic, not a bare store call, so it lives here once rather than being copied into each tool. */
export function performReadHistory(reader: IHistoryReader, input: ReadHistoryInput): ReadHistoryOutput {
  const citations = input.citations.map((citation) => ({ conversationId: citation.session, turnId: citation.turnId }));
  const windows = reader.read({ citations, window: input.window });
  return windows.map((window) => ({
    session: window.conversationId,
    turnId: window.turnId,
    events: window.events.map((event) => ({ turnId: event.turnId, timestamp: event.timestamp, role: event.role, type: event.type as EventType, text: event.text })),
  }));
}
