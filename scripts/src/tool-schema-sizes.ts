// Prints the JSON-serialized wire format length of each tool's schema definition.
// Useful for gauging whether the tool library is large enough to benefit from
// advanced tool use deferred loading (generally worth it above ~10K total chars).
//
// Run from the repo root:
//   pnpm tsx src/tool-schema-sizes.ts

import { Clock } from '@js-joda/core';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import type { HistoryReadRequest, HistorySearchHit, HistorySearchQuery, HistoryWindow } from '@shellicar/claude-core/history/types';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { MemoryDraft, MemoryEntry, MemorySearchHit, MemoryTypeCount } from '@shellicar/claude-core/memory/types';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { toWireTool } from '@shellicar/claude-sdk';
import { createAppTools } from '@shellicar/claude-sdk-cli/src/createAppTools.js';
import { ISecrets } from '@shellicar/claude-sdk-cli/src/secrets/Secrets.js';
import { IEnvProvider } from '@shellicar/claude-sdk-tools/ExecV3';
import type { ITypeScriptService } from '@shellicar/claude-sdk-tools/TsService';

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

class StubHistoryReader extends IHistoryReader {
  public search(_query: HistorySearchQuery): HistorySearchHit[] {
    return [];
  }
  public read(_request: HistoryReadRequest): HistoryWindow[] {
    return [];
  }
}

class StubSecrets extends ISecrets {
  public ghHolderToken(): string {
    return '';
  }
  public ghReaderToken(): string {
    return '';
  }
  public azCert(): string {
    return '';
  }
}

class StubEnvProvider extends IEnvProvider {
  public buildEnv(cmdEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { ...process.env, ...cmdEnv };
  }
}

class StubLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

const stubFs = null as unknown as IFileSystem;

const { tools } = createAppTools({
  fs: stubFs,
  tsServer: stubTs,
  toolsConfig: { exec: false, execV2: true, execV3: true },
  objects: new StubObjectStore(),
  memory: new StubMemoryStore(),
  history: new StubHistoryReader(),
  currentSessionId: () => '',
  clock: Clock.systemUTC(),
  tsAvailable: false,
  logger: new StubLogger(),
  secrets: new StubSecrets(),
  envProvider: new StubEnvProvider(),
  azAccounts: {},
});

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
