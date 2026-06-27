// Prints the JSON-serialized wire format length of each tool's schema definition.
// Useful for gauging whether the tool library is large enough to benefit from
// advanced tool use deferred loading (generally worth it above ~10K total chars).
//
// Run from the repo root:
//   pnpm tsx scripts/src/tool-schema-sizes.ts

import { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { MemoryDraft, MemoryEntry, MemorySearchHit, MemoryTypeCount } from '@shellicar/claude-core/memory/types';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { toWireTool } from '@shellicar/claude-sdk';
import type { ITypeScriptService } from '@shellicar/claude-sdk-tools/TsService';
import { createAppTools } from '../../apps/claude-sdk-cli/src/createAppTools.js';

// Stubs — handlers are never invoked here; only name/description/schema/examples matter.
const stubTs = null as unknown as ITypeScriptService;

class StubObjectStore extends IObjectStore {
  public set(): void {}
  public get(): string | undefined {
    return undefined;
  }
}

class StubMemoryStore extends IMemoryStore {
  public async write(draft: MemoryDraft): Promise<MemoryEntry> {
    return { id: '', title: draft.title, body: draft.body, type: draft.type, keywords: draft.keywords, environment: {}, createdAt: '' };
  }
  public async read(): Promise<MemoryEntry | undefined> {
    return undefined;
  }
  public async search(): Promise<MemorySearchHit[]> {
    return [];
  }
  public async delete(): Promise<void> {}
  public async types(): Promise<MemoryTypeCount[]> {
    return [];
  }
}

const { tools } = createAppTools({ tsServer: stubTs, toolsConfig: { exec: false, execV2: true }, objects: new StubObjectStore(), memory: new StubMemoryStore() });

const sizes = tools.map((tool) => ({
  name: tool.name,
  chars: JSON.stringify(toWireTool(tool)).length,
}));

sizes.sort((a, b) => b.chars - a.chars);

const total = sizes.reduce((sum, s) => sum + s.chars, 0);
const nameWidth = Math.max(...sizes.map((s) => s.name.length), 'Tool'.length);
const sep = '-'.repeat(nameWidth + 10);

console.log(`${'Tool'.padEnd(nameWidth)}  Chars`);
console.log(sep);
for (const { name, chars } of sizes) {
  console.log(`${name.padEnd(nameWidth)}  ${chars.toLocaleString()}`);
}
console.log(sep);
console.log(`${'Total'.padEnd(nameWidth)}  ${total.toLocaleString()}`);
