import type { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { fromLines } from '@shellicar/orchestrate-core';
import { MemoryTypesInputSchema } from '../../Memory/schema.js';
import { defineToolV2 } from '../defineToolV2.js';

/** The V2 tool equivalent of V1's `MemoryTypes` — same `IMemoryStore.types`, same input schema. */
export function createMemoryTypesToolV2(store: IMemoryStore) {
  return defineToolV2({
    name: 'MemoryTypes',
    description: 'List the distinct memory types in use with their counts, so you reuse an established word rather than coin a near-duplicate.',
    operation: 'none',
    model: MemoryTypesInputSchema,
    run: (): ToolV2Result => {
      async function* run(): AsyncGenerator<string, void, unknown> {
        const types = await store.types();
        for (const t of types) {
          yield `${t.type}: ${t.count}`;
        }
      }
      return { stdout: fromLines(run()), success: () => true };
    },
  });
}
