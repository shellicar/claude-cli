import type { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { ReadMemoryInputSchema } from '../../Memory/schema.js';
import type { ReadMemoryOutput } from '../../Memory/types.js';
import { defineToolV2 } from '../defineToolV2.js';

/** The V2 tool equivalent of V1's `ReadMemory` — same `IMemoryStore.read`, same input schema. */
export function createReadMemoryToolV2(store: IMemoryStore) {
  return defineToolV2({
    name: 'ReadMemory',
    description: 'Fetch one memory by its id. Returns not-found if the id is unknown or has been retired.',
    operation: 'none',
    model: ReadMemoryInputSchema,
    run: (input): ToolV2Result<string> => {
      async function* run(): Stream<string> {
        const memory = await store.read(input.id);
        const out: ReadMemoryOutput = memory === undefined ? { found: false, id: input.id } : { found: true, memory };
        for (const line of JSON.stringify(out, null, 2).split('\n')) {
          yield line;
        }
      }
      return { stdout: run(), success: () => true };
    },
  });
}
