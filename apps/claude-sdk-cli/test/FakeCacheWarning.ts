import type { AuditDerivation } from '../src/AuditStats.js';
import type { CacheParameters } from '../src/model/ModelSettings.js';
import { ICacheWarning } from '../src/setup/CacheWarning.js';

/** A counting no-op `ICacheWarning`, for specs that exercise a seam the warning happens to sit on
 *  without asserting anything about it. What the warning says is proved in its own spec. */
export class FakeCacheWarning extends ICacheWarning {
  public refreshes = 0;
  public readonly prefetched: string[] = [];

  public refresh(): void {
    this.refreshes += 1;
  }

  /** Takes the audit at its word and assumes nothing, so a spec sees only what the audit held. */
  public baselineFor(audit: AuditDerivation): CacheParameters | null {
    return audit.cached;
  }

  public prefetch(model: string): void {
    this.prefetched.push(model);
  }
}
