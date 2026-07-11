/**
 * The runtime value the TypeScript server needs, computed once in `main` and
 * registered as one options object (decision 8): the resolved on-disk
 * tsserver.js path (`null` when typescript cannot be found, so the server
 * degrades and the TS tools are left out). `TsServerClient` injects this rather
 * than reaching for `resolveTsServerPath()`.
 */
export abstract class ITsServerOptions {
  public abstract readonly tsserverPath: string | null;
  /** Per-request ceiling before a tsserver command is abandoned as a timeout.
   * Injected so it is not a magic constant and a test can shorten it. */
  public abstract readonly timeoutMs: number;
}

/** Default per-request timeout: a fresh spawn answers a real query in ~1s, so a
 * couple of seconds is ample headroom without the old 15s POC stall. */
export const DEFAULT_TSSERVER_TIMEOUT_MS = 3000;
