import type { PolicySet } from './types.js';
import type { ToolLookup, ValidationResult } from './validatePolicy.js';
import { validatePolicy } from './validatePolicy.js';

/** The maximally conservative fallback \u2014 ask for everything. Used only when there is
 *  otherwise no valid policy to fall back to (construction-time only): never allow, never
 *  silently run with no policy at all. */
const SAFE_DEFAULT: PolicySet = [{ default: 'ask' }];

export type UpdateResult = { accepted: true; warnings: string[] } | { accepted: false; errors: string[] };

/** Holds the currently-active policy, and only ever replaces it with a new one that validates.
 *  An update that fails case 1 or case 2 leaves the previous policy in place untouched \u2014 a
 *  reload never leaves the store without SOME policy, and never silently degrades to a worse
 *  one. Case 3 (a rule for a tool that isn't loaded yet) is accepted, with its warning
 *  surfaced, since it isn't a provable mistake. */
export class PolicyStore {
  #current: PolicySet;
  readonly #registry: ToolLookup;

  public constructor(initial: unknown, registry: ToolLookup) {
    this.#registry = registry;
    const result = validatePolicy(initial, registry);
    this.#current = result.valid ? (initial as PolicySet) : SAFE_DEFAULT;
  }

  public get current(): PolicySet {
    return this.#current;
  }

  public update(candidate: unknown): UpdateResult {
    const result: ValidationResult = validatePolicy(candidate, this.#registry);
    if (!result.valid) {
      return { accepted: false, errors: result.errors };
    }
    this.#current = candidate as PolicySet;
    return { accepted: true, warnings: result.warnings };
  }
}
