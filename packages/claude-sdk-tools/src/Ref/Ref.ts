import { defineTool } from '@shellicar/claude-sdk';
import type { RefStore } from '../RefStore/RefStore';
import { RefInputSchema } from './schema';
import type { RefOutput } from './types';

export function createRef(store: RefStore) {
  return defineTool({
    name: 'Ref',
    description:
      'Fetch the content of a stored ref. When a tool result contains { ref, size, hint } instead of the full value, use this tool to retrieve it. Optionally slice by character offset (start/end) to read large content in chunks.',
    input_schema: RefInputSchema,
    input_examples: [
      { id: 'uuid-...' },
      { id: 'uuid-...', start: 0, end: 2000 },
    ],
    handler: async (input): Promise<RefOutput> => {
      const content = store.get(input.id);
      if (content === undefined) {
        return { found: false, id: input.id };
      }

      const start = input.start ?? 0;
      const end = input.end ?? content.length;
      const slice = content.slice(start, end);

      return {
        found: true,
        content: slice,
        totalSize: content.length,
        start,
        end: Math.min(end, content.length),
      } satisfies RefOutput;
    },
  });
}
