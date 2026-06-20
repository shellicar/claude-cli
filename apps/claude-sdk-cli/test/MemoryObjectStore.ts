import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';

/** In-memory IObjectStore for tests. Keyed by collection + id, never touches disk. */
export class MemoryObjectStore extends IObjectStore {
  readonly #data = new Map<string, string>();

  #key(collection: string, id: string): string {
    return `${collection}\u0000${id}`;
  }

  public set(collection: string, id: string, value: string): void {
    this.#data.set(this.#key(collection, id), value);
  }

  public get(collection: string, id: string): string | undefined {
    return this.#data.get(this.#key(collection, id));
  }
}
