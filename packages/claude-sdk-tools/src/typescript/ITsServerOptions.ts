/**
 * The runtime value the TypeScript server needs, computed once in `main` and
 * registered as one options object (decision 8): the resolved on-disk
 * tsserver.js path (`null` when typescript cannot be found, so the server
 * degrades and the TS tools are left out). `TsServerClient` injects this rather
 * than reaching for `resolveTsServerPath()`.
 */
export abstract class ITsServerOptions {
  public abstract readonly tsserverPath: string | null;
}
