/**
 * The runtime values the TypeScript server needs, computed once in `main` and
 * registered as one options object (decision 8): the working directory and the
 * resolved on-disk tsserver.js path (`null` when typescript cannot be found, so
 * the server degrades and the TS tools are left out). `TsServerService` injects
 * this rather than reaching for `process.cwd()` / `resolveTsServerPath()`.
 */
export abstract class ITsServerOptions {
  public abstract readonly cwd: string;
  public abstract readonly tsserverPath: string | null;
}
