import { defineTool } from '@shellicar/claude-sdk';
import type { RefStore } from '../RefStore/RefStore';
import { RefInputSchema } from './schema';
import type { RefOutput } from './types';

export type CreateRefResult = {
  /** The Ref query tool — add to the agent's tool list. */
  tool: ReturnType<typeof defineTool<typeof RefInputSchema, RefOutput>>;
  /** Pass as transformToolResult on RunAgentQuery. Walks the output tree and ref-swaps any string exceeding the threshold. */
  transformToolResult: (toolName: string, output: unknown) => unknown;
};

export function createRef(store: RefStore, threshold: number): CreateRefResult {
  const tool = defineTool({
    name: 'Ref',
    description:
      `Fetch the content of a stored ref. When a tool result contains { ref, size, hint } instead of the full value, use this tool to retrieve it. Optionally slice by character offset (start/end) to read large content in chunks.`,
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

  const transformToolResult = (toolName: string, output: unknown): unknown => {
    // Never ref-swap the Ref tool's own output — Claude needs the content directly.
    if (toolName === 'Ref') return output;
    return store.walkAndRef(output, threshold, toolName);
  };

  return { tool, transformToolResult };
}
