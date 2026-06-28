/**
 * Injectable source of randomness in [0, 1). Replaces the `random = Math.random`
 * constructor default so backoff jitter is deterministic under test.
 */
export abstract class IRandomProvider {
  public abstract next(): number;
}
