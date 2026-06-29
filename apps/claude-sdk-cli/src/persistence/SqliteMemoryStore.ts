import { IMemoryEnvironmentProvider } from '@shellicar/claude-core/memory/environment-provider';
import { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { MemoryDraft, MemoryEntry, MemorySearchHit, MemorySearchQuery, MemoryTypeCount } from '@shellicar/claude-core/memory/types';
import { dependsOn } from '@shellicar/core-di-lite';
import { SqliteMemoryEngine } from './SqliteMemoryEngine.js';

export class SqliteMemoryStore extends IMemoryStore {
  @dependsOn(IMemoryEnvironmentProvider) private environmentProvider!: IMemoryEnvironmentProvider;
  @dependsOn(SqliteMemoryEngine) private engine!: SqliteMemoryEngine;

  public async write(draft: MemoryDraft): Promise<MemoryEntry> {
    // Resolved per write: the remote/cwd/config in effect now, never a launch-time snapshot.
    const environment = await this.environmentProvider.resolve();
    return this.engine.write(draft, environment);
  }

  public async read(id: string): Promise<MemoryEntry | undefined> {
    return this.engine.read(id);
  }

  public async search(query: MemorySearchQuery): Promise<MemorySearchHit[]> {
    return this.engine.search(query);
  }

  public async delete(id: string): Promise<void> {
    this.engine.delete(id);
  }

  public async types(): Promise<MemoryTypeCount[]> {
    return this.engine.types();
  }
}
