import { z } from 'zod';
import { parseTimeBound } from './timeBound';

// The raw Anthropic block vocabulary the record carries — no renames, Claude already knows the API's types.
const eventType = z.enum(['text', 'thinking', 'tool_use', 'tool_result']);
const eventRole = z.enum(['user', 'assistant']);

// A `since` / `until` time bound: a relative span (7d, 2w, 3m, 1y — m is month, no hours) or an absolute local date
// (YYYY, YYYY-MM, YYYY-MM-DD). parseTimeBound is the validity oracle — it rejects a garbled span and an impossible
// calendar date (2026-13, 2026-06-31) alike, so a malformed bound errors here rather than silently widening a search.
const TimeBound = z.string().refine((value) => parseTimeBound(value) !== null, {
  message: 'Expected a relative span (e.g. 7d, 2w, 3m, 1y) or an absolute date (YYYY, YYYY-MM, YYYY-MM-DD).',
});

export const SearchHistoryInputSchema = z
  .object({
    query: z.string().describe('Terms to search across your past conversations.'),
    role: eventRole.optional().describe("Narrow to one side: your messages or the assistant's."),
    type: eventType.optional().describe('Narrow to one kind of event.'),
    since: TimeBound.optional().describe('Lower bound, inclusive. An absolute value snaps to the start of its period (2026-06 → 1 June).'),
    until: TimeBound.optional().describe('Upper bound, inclusive. An absolute value snaps to the end of its period (2026-06 → 30 June).'),
    limit: z.number().int().positive().default(10).describe('Maximum hits to return.'),
    includeCurrentSession: z.boolean().default(false).describe('The live session is excluded as noise by default; set true to include it.'),
  })
  .strict();

export const SearchHistoryOutputSchema = z.array(
  z.object({
    session: z.string().describe('Session id; pass to ReadHistory.'),
    turnId: z.string().describe('Turn id; pass to ReadHistory.'),
    timestamp: z.string().describe('ISO time of the turn.'),
    role: eventRole,
    type: eventType,
    snippet: z.string().describe('~40-token window around the match — enough to pick a hit, not to judge it.'),
  }),
);

export const ReadHistoryInputSchema = z
  .object({
    citations: z
      .array(
        z.object({
          session: z.string().describe('Session id from a search hit.'),
          turnId: z.string().describe('Turn id from a search hit; the centre of the window.'),
        }),
      )
      .describe('One or more moments to open.'),
    window: z.number().int().nonnegative().default(3).describe('Turns to include either side of each centre.'),
  })
  .strict();

export const ReadHistoryOutputSchema = z.array(
  z.object({
    session: z.string(),
    turnId: z.string(),
    events: z.array(
      z.object({
        turnId: z.string(),
        timestamp: z.string(),
        role: eventRole,
        type: eventType,
        text: z.string().describe("Full event text, capped per event so one giant tool_result can't flood context."),
      }),
    ),
  }),
);
