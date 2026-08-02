import type { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { fromLines } from '@shellicar/orchestrate-core';
import { WriteMemoryInputSchema } from '../../Memory/schema.js';
import { defineToolV2 } from '../defineToolV2.js';

/** The V2 tool equivalent of V1's `WriteMemory` — same `IMemoryStore.write`, same input schema,
 *  reused verbatim. The only difference is the output shape: V1 returns the stored entry as one
 *  JSON value; V2 splits it into lines, the plain-text convention every V2 tool follows. */
export function createWriteMemoryToolV2(store: IMemoryStore) {
  return defineToolV2({
    name: 'WriteMemory',
    description: 'Write a memory for any later Claude to find. Records what you learned — a trap, a decision and its reasoning, a correction — so it survives this session. Title is the handle that ranks; body is the memory; type classifies it.',
    operation: 'none',
    model: WriteMemoryInputSchema,
    run: (input): ToolV2Result => {
      async function* run(): AsyncGenerator<string, void, unknown> {
        const memory = await store.write({ title: input.title, body: input.body, type: input.type, keywords: input.keywords });
        for (const line of JSON.stringify(memory, null, 2).split('\n')) {
          yield line;
        }
      }
      return { stdout: fromLines(run()), success: () => true };
    },
  });
}
