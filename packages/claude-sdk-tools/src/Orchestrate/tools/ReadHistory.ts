import type { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import type { ToolV2Result } from '@shellicar/orchestrate-core';
import { fromLines } from '@shellicar/orchestrate-core';
import { performReadHistory } from '../../History/performReadHistory.js';
import { ReadHistoryInputSchema } from '../../History/schema.js';
import { defineToolV2 } from '../defineToolV2.js';

/** The V2 tool equivalent of V1's `ReadHistory` — same `performReadHistory`, same input schema. */
export function createReadHistoryToolV2(reader: IHistoryReader) {
  return defineToolV2({
    name: 'ReadHistory',
    description: 'Open the full exchange around one or more search citations. Each citation is a { session, turnId } from a SearchHistory hit; the shared `window` sets how many turns either side of each centre to include. Each event text is capped so one giant tool_result cannot flood context.',
    operation: 'none',
    model: ReadHistoryInputSchema,
    run: (input): ToolV2Result => {
      async function* run(): AsyncGenerator<string, void, unknown> {
        const windows = performReadHistory(reader, input);
        for (const line of JSON.stringify(windows, null, 2).split('\n')) {
          yield line;
        }
      }
      return { stdout: fromLines(run()), success: () => true };
    },
  });
}
