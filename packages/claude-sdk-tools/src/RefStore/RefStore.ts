import { randomUUID } from 'node:crypto';

export type RefToken = {
  ref: string;
  size: number;
  hint: string;
};

export class RefStore {
  readonly #store = new Map<string, string>();
  readonly #hints = new Map<string, string>();

  public store(content: string, hint = ''): string {
    const id = randomUUID();
    this.#store.set(id, content);
    this.#hints.set(id, hint);
    return id;
  }

  public get(id: string): string | undefined {
    return this.#store.get(id);
  }

  public getHint(id: string): string | undefined {
    return this.#hints.get(id);
  }

  public has(id: string): boolean {
    return this.#store.has(id);
  }

  public delete(id: string): void {
    this.#store.delete(id);
    this.#hints.delete(id);
  }

  public get count(): number {
    return this.#store.size;
  }

  public get bytes(): number {
    let total = 0;
    for (const v of this.#store.values()) {
      total += v.length;
    }
    return total;
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
