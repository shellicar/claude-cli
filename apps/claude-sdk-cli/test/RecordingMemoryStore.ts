import { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { MemoryDraft, MemoryEntry, MemorySearchHit, MemorySearchQuery, MemoryTypeCount } from '@shellicar/claude-core/memory/types';

// A fixed constant — NOT store behaviour. write() must return an entry even when a
// test does not set one; a test that asserts write-shaping sets `writeResult`.
const STUB_ENTRY: MemoryEntry = { id: 'stub-id', title: '', body: '', type: '', keywords: [], environment: {}, createdAt: 'stub' };

/**
 * A spy IMemoryStore for the app tests. It re-implements no store behaviour:
 * each method records the argument it was called with and returns a canned
 * value the test sets. Used where createAppTools needs an IMemoryStore but the
 * handlers are never invoked.
 */
export class RecordingMemoryStore extends IMemoryStore {
  public writeArg: MemoryDraft | undefined;
  public readArg: string | undefined;
  public searchArg: MemorySearchQuery | undefined;
  public deleteArg: string | undefined;
  public typesCalled = false;

  public writeResult: MemoryEntry | undefined;
  public readResult: MemoryEntry | undefined;
  public searchResult: MemorySearchHit[] = [];
  public typesResult: MemoryTypeCount[] = [];

  public async write(draft: MemoryDraft): Promise<MemoryEntry> {
    this.writeArg = draft;
    return this.writeResult ?? STUB_ENTRY;
  }

  public async read(id: string): Promise<MemoryEntry | undefined> {
    this.readArg = id;
    return this.readResult;
  }

  public async search(query: MemorySearchQuery): Promise<MemorySearchHit[]> {
    this.searchArg = query;
    return this.searchResult;
  }

  public async delete(id: string): Promise<void> {
    this.deleteArg = id;
  }

  public async types(): Promise<MemoryTypeCount[]> {
    this.typesCalled = true;
    return this.typesResult;
  }
}
