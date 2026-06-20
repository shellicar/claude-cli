import { randomUUID } from 'node:crypto';
import type { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';

const COLLECTION = 'ref';

export type RefToken = {
  ref: string;
  size: number;
  hint: string;
};

export class RefStore {
  readonly #objects: IObjectStore;

  public constructor(objects: IObjectStore) {
    this.#objects = objects;
  }

  public store(content: string, hint = ''): string {
    const id = randomUUID();
    this.#objects.set(COLLECTION, id, JSON.stringify({ content, hint }));
    return id;
  }

  public get(id: string): string | undefined {
    const raw = this.#objects.get(COLLECTION, id);
    return raw === undefined ? undefined : (JSON.parse(raw) as { content: string }).content;
  }

  public getHint(id: string): string | undefined {
    const raw = this.#objects.get(COLLECTION, id);
    return raw === undefined ? undefined : (JSON.parse(raw) as { hint: string }).hint;
  }

  /**
   * Walk a JSON-compatible value tree. Any string value whose length exceeds
   * `threshold` chars is stored in the ref store and replaced with a RefToken.
   * Numbers, booleans, null, and short strings pass through unchanged.
   * Objects and arrays are recursed into.
   */
  public walkAndRef(value: unknown, threshold: number, hint = ''): unknown {
    if (typeof value === 'string') {
      if (value.length > threshold) {
        const id = this.store(value, hint);
        return { ref: id, size: value.length, hint } satisfies RefToken;
      }
      return value;
    }

    if (Array.isArray(value)) {
      // For uniform string arrays, check total joined length — individual lines may each be
      // short but the array as a whole (e.g. ReadFile values) can be enormous.
      if (value.length > 0 && value.every((x) => typeof x === 'string')) {
        const joined = (value as string[]).join('\n');
        if (joined.length > threshold) {
          const id = this.store(joined, hint);
          return { ref: id, size: joined.length, hint } satisfies RefToken;
        }
      }
      return value.map((item, i) => this.walkAndRef(item, threshold, hint ? `${hint}[${i}]` : `[${i}]`));
    }

    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = this.walkAndRef(v, threshold, hint ? `${hint}.${k}` : k);
      }
      return result;
    }

    return value;
  }
}
