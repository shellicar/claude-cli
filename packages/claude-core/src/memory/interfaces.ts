import type { MemoryDraft, MemoryEntry, MemorySearchHit, MemorySearchQuery, MemoryTypeCount } from './types';

export abstract class IMemoryStore {
  /** Persist a new memory. The store stamps `id`, `createdAt`, and the environment in effect at write time; returns the stored entry so the caller learns the id it can later read or delete. */
  public abstract write(draft: MemoryDraft): Promise<MemoryEntry>;

  /** Fetch one memory by id. Resolves `undefined` when the id is unknown or soft-deleted — the two are indistinguishable to the caller by design. */
  public abstract read(id: string): Promise<MemoryEntry | undefined>;

  /** Relevance search. Plain words in, ranked hits out, best first. `type` may narrow; it never must. Soft-deleted memories are invisible. */
  public abstract search(query: MemorySearchQuery): Promise<MemorySearchHit[]>;

  /** Retire a memory. Soft delete, idempotent: deleting an unknown or already-deleted id resolves without error. The purpose is retiring a memory to rewrite it. */
  public abstract delete(id: string): Promise<void>;

  /** Distinct live types with counts, so a writer reuses an established word (`testament`, not `testaments`) rather than drift. */
  public abstract types(): Promise<MemoryTypeCount[]>;
}
