import type { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { DeleteMemoryInputSchema, DeleteMemoryOutputSchema, MemoryTypesInputSchema, MemoryTypesOutputSchema, ReadMemoryInputSchema, ReadMemoryOutputSchema, SearchMemoryInputSchema, SearchMemoryOutputSchema, WriteMemoryInputSchema, WriteMemoryOutputSchema } from './schema';
import type { DeleteMemoryOutput, MemoryTypesOutput, ReadMemoryOutput, SearchMemoryOutput, WriteMemoryOutput } from './types';

export function createMemoryTools(store: IMemoryStore) {
  const WriteMemory = defineTool({
    name: 'WriteMemory',
    operation: 'write',
    description: 'Write a memory for any later Claude to find. Records what you learned — a trap, a decision and its reasoning, a correction — so it survives this session. Title is the handle that ranks; body is the memory; type classifies it.',
    input_schema: WriteMemoryInputSchema,
    output_schema: WriteMemoryOutputSchema,
    input_examples: [
      {
        title: 'node:sqlite cannot open a database in a missing directory',
        body: 'Call mkdirSync(dirname(path), { recursive: true }) before new DatabaseSync(path), or it throws.',
        type: 'trap',
        keywords: ['sqlite', 'DatabaseSync'],
        intent: 'recording the missing-dir trap I just hit',
      },
      {
        title: 'We depend on @anthropic-ai/sdk directly rather than re-exporting it through a wrapper',
        body: 'Re-exporting hid version drift between packages. A direct dependency forces each package to re-pin explicitly, so a consumer resolving one package gets the matching SDK version. Chosen to fit the lockstep release model.',
        type: 'decision',
        keywords: ['dependency', 'release'],
        intent: 'capturing why the SDK dependency is direct, with the reasoning',
      },
      {
        title: 'Tool handlers return { textContent, attachments }, never a bare value',
        body: 'The ToolRegistry sends textContent through the transform and places attachments straight into tool_result.content as API content blocks. Returning a bare value skips both paths.',
        type: 'pattern',
        intent: 'noting the handler return contract so the next Claude follows it',
      },
    ],
    handler: async (input) => {
      const memory = await store.write({ title: input.title, body: input.body, type: input.type, keywords: input.keywords });
      return { textContent: memory satisfies WriteMemoryOutput };
    },
  });

  const ReadMemory = defineTool({
    name: 'ReadMemory',
    operation: 'read',
    description: 'Fetch one memory by its id. Returns not-found if the id is unknown or has been retired.',
    input_schema: ReadMemoryInputSchema,
    output_schema: ReadMemoryOutputSchema,
    input_examples: [{ id: 'uuid-...', intent: 'reading the memory SearchMemory ranked first' }],
    handler: async (input) => {
      const memory = await store.read(input.id);
      const out: ReadMemoryOutput = memory === undefined ? { found: false, id: input.id } : { found: true, memory };
      return { textContent: out };
    },
  });

  const SearchMemory = defineTool({
    name: 'SearchMemory',
    operation: 'read',
    description: 'Search every memory by relevance. Describe what you need in plain words; the most relevant memories come back ranked, best first. Optionally narrow to one type. Results are NOT scoped to the current repository — search spans every memory in the store. Each hit carries the environment (host/org/repo) it was written in; that is there to help you judge whether a memory is relevant to what you are doing now, not to filter results. The only isolation is the tenantId in CLI config, which selects a separate store.',
    input_schema: SearchMemoryInputSchema,
    output_schema: SearchMemoryOutputSchema,
    input_examples: [
      { query: 'sqlite missing directory error on startup', intent: 'looking for prior traps about the store failing to open' },
      { query: 'release process beta versioning', type: 'decision', limit: 5, intent: 'finding decisions about the release flow' },
    ],
    handler: async (input) => {
      const results = await store.search({ query: input.query, type: input.type, limit: input.limit });
      return { textContent: { count: results.length, results } satisfies SearchMemoryOutput };
    },
  });

  const DeleteMemory = defineTool({
    name: 'DeleteMemory',
    operation: 'delete',
    description: 'Retire a memory by id so it stops surfacing in search — use when rewriting a memory that is wrong. Idempotent: deleting an unknown or already-retired id still succeeds.',
    input_schema: DeleteMemoryInputSchema,
    output_schema: DeleteMemoryOutputSchema,
    input_examples: [{ id: 'uuid-...', intent: 'removing the wrong note about the SEA build' }],
    handler: async (input) => {
      await store.delete(input.id);
      return { textContent: { deleted: true, id: input.id } satisfies DeleteMemoryOutput };
    },
  });

  const MemoryTypes = defineTool({
    name: 'MemoryTypes',
    operation: 'read',
    description: 'List the distinct memory types in use with their counts, so you reuse an established word rather than coin a near-duplicate.',
    input_schema: MemoryTypesInputSchema,
    output_schema: MemoryTypesOutputSchema,
    input_examples: [{}],
    handler: async () => {
      const types = await store.types();
      return { textContent: { types } satisfies MemoryTypesOutput };
    },
  });

  // `as const` returns a readonly tuple, not a widened array, so a caller that destructures keeps each tool's precise type (the handler tests call into a specific tool and narrow its output).
  return [WriteMemory, ReadMemory, SearchMemory, DeleteMemory, MemoryTypes] as const;
}
