import type { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { DeleteMemoryInputSchema } from '../../Memory/schema.js';
import { defineToolV2 } from '../defineToolV2.js';

/** The V2 tool equivalent of V1's `DeleteMemory` — same `IMemoryStore.delete`, same input schema. */
export function createDeleteMemoryToolV2(store: IMemoryStore) {
  return defineToolV2({
    name: 'DeleteMemory',
    description: 'Retire a memory by id so it stops surfacing in search — use when rewriting a memory that is wrong. Idempotent: deleting an unknown or already-retired id still succeeds.',
    operation: 'none',
    model: DeleteMemoryInputSchema,
    run: (input): ToolV2Result<string> => {
      async function* run(): Stream<string> {
        await store.delete(input.id);
        yield JSON.stringify({ deleted: true, id: input.id });
      }
      return { stdout: run(), success: () => true };
    },
  });
}
