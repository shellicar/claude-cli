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

/** Default per-request timeout. The bridge spawns a fresh tsserver per tool
 * block, so the first request of every block pays the cold cost of loading
 * the whole program/type graph — on a real repo that can run well past a few
 * seconds, not just the ~1s a small fixture answers in. 3s was sized for a
 * server spawned once at startup and reused; now that it's spawned per block,
 * that cold load happens on every block's first request, so it needs real
 * headroom. */
export const DEFAULT_TSSERVER_TIMEOUT_MS = 30_000;
