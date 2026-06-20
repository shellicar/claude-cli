export abstract class IObjectStore {
  /** Store `value` under (`collection`, `id`), durable when the call returns. Overwrites any existing value. */
  public abstract set(collection: string, id: string, value: string): void;
  /** Retrieve the value for (`collection`, `id`), or `undefined` if absent. */
  public abstract get(collection: string, id: string): string | undefined;
}
