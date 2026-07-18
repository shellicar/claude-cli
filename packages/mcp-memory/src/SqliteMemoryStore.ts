import type { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { MemoryDraft, MemoryEntry, MemorySearchHit, MemorySearchQuery, MemoryTypeCount } from '@shellicar/claude-core/memory/types';
import { readGitEnvironment } from './gitEnvironment.js';
import type { SqliteMemoryEngine } from './SqliteMemoryEngine.js';

export class SqliteMemoryStore implements IMemoryStore {
  readonly #engine: SqliteMemoryEngine;

  public constructor(engine: SqliteMemoryEngine) {
    this.#engine = engine;
  }

  public async write(draft: MemoryDraft): Promise<MemoryEntry> {
    const environment = await readGitEnvironment();
    return this.#engine.write(draft, environment);
  }

  public async read(id: string): Promise<MemoryEntry | undefined> {
    return this.#engine.read(id);
  }

  public async search(query: MemorySearchQuery): Promise<MemorySearchHit[]> {
    return this.#engine.search(query);
  }

  public async delete(id: string): Promise<void> {
    this.#engine.delete(id);
  }

  public async types(): Promise<MemoryTypeCount[]> {
    return this.#engine.types();
  }
}
