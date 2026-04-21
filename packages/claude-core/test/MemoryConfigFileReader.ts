import { IConfigFileReader } from '../src/Config/interfaces';

/**
 * In-memory `IConfigFileReader` for tests. Paths are keyed strings and
 * content is stored as the UTF-8 string that `read()` returns.
 *
 * Mutation helpers (`set`, `delete`) exist so tests can simulate file
 * changes between `load()` calls.
 */
export class MemoryConfigFileReader extends IConfigFileReader {
  readonly #files: Map<string, string>;

  public constructor(initial: Record<string, string> = {}) {
    super();
    this.#files = new Map(Object.entries(initial));
  }

  public exists(path: string): boolean {
    return this.#files.has(path);
  }

  public read(path: string): string {
    const content = this.#files.get(path);
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return content;
  }

  public set(path: string, content: string): void {
    this.#files.set(path, content);
  }

  public delete(path: string): void {
    this.#files.delete(path);
  }
}
