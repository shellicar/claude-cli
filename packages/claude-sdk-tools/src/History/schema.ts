import { z } from 'zod';

// The raw Anthropic block vocabulary the record carries — no renames, Claude already knows the API's types.
const eventType = z.enum(['text', 'thinking', 'tool_use', 'tool_result']);
const eventRole = z.enum(['user', 'assistant']);

export const SearchHistoryInputSchema = z
  .object({
    query: z.string().describe('Terms to search across your past conversations.'),
    role: eventRole.optional().describe("Narrow to one side: your messages or the assistant's."),
    type: eventType.optional().describe('Narrow to one kind of event.'),
    since: z.string().optional().describe("Relative span like '7d' or '2w'; drop anything older."),
    limit: z.number().int().positive().default(10).describe('Maximum hits to return.'),
    includeCurrentSession: z.boolean().default(false).describe('The live session is excluded as noise by default; set true to include it.'),
  })
  .strict();

export const SearchHistoryOutputSchema = z.array(
  z.object({
    session: z.string().describe('Session id; pass to ReadHistory.'),
    turn: z.number().int().describe('Turn within the session; pass to ReadHistory.'),
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
          turn: z.number().int().describe('Turn from a search hit; the centre of the window.'),
        }),
      )
      .describe('One or more moments to open.'),
    window: z.number().int().nonnegative().default(3).describe('Turns to include either side of each centre.'),
  })
  .strict();

export const ReadHistoryOutputSchema = z.array(
  z.object({
    session: z.string(),
    turn: z.number().int(),
    events: z.array(
      z.object({
        turn: z.number().int(),
        timestamp: z.string(),
        role: eventRole,
        type: eventType,
        text: z.string().describe("Full event text, capped per event so one giant tool_result can't flood context."),
      }),
    ),
  }),
);
