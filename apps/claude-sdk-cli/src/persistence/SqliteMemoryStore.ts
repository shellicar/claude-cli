import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Clock } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IMemoryEnvironmentProvider } from '@shellicar/claude-core/memory/environment-provider';
import { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { MemoryDraft, MemoryEntry, MemorySearchHit, MemorySearchQuery, MemoryTypeCount } from '@shellicar/claude-core/memory/types';
import { nodeFs } from '@shellicar/claude-sdk-tools/fs';
import { dependsOn } from '@shellicar/core-di-lite';
import { SqliteMemoryEngine } from './SqliteMemoryEngine.js';

export class SqliteMemoryStore extends IMemoryStore {
  @dependsOn(ConfigLoader)
  public configLoader!: ConfigLoader<any>;

  @dependsOn(IMemoryEnvironmentProvider)
  public environmentProvider!: IMemoryEnvironmentProvider;

  #engine: SqliteMemoryEngine | undefined;

  // No constructor: core-di-lite sets the @dependsOn fields AFTER construction,
  // so opening the database here would see undefined config. The engine is opened
  // lazily on first use, by which point injection has completed.
  #ready(): SqliteMemoryEngine {
    if (this.#engine === undefined) {
      const tenantId = this.configLoader.config.memory.tenantId;
      const file = tenantId == null ? 'memory.db' : `memory.${tenantId}.db`;
      const path = `${nodeFs.homedir()}/.claude/${file}`;
      mkdirSync(dirname(path), { recursive: true });
      this.#engine = new SqliteMemoryEngine(new DatabaseSync(path), Clock.systemUTC());
    }
    return this.#engine;
  }

  public async write(draft: MemoryDraft): Promise<MemoryEntry> {
    // Resolved per write: the remote/cwd/config in effect now, never a launch-time snapshot.
    const environment = await this.environmentProvider.resolve();
    return this.#ready().write(draft, environment);
  }

  public async read(id: string): Promise<MemoryEntry | undefined> {
    return this.#ready().read(id);
  }

  public async search(query: MemorySearchQuery): Promise<MemorySearchHit[]> {
    return this.#ready().search(query);
  }

  public async delete(id: string): Promise<void> {
    this.#ready().delete(id);
  }

  public async types(): Promise<MemoryTypeCount[]> {
    return this.#ready().types();
  }
}
