/**
 * Tells `DatabaseFactory` whether to open real on-disk databases or `:memory:`.
 * Set once at composition: `runApp` registers `{ inMemory: false }`, `runVerify`
 * registers `{ inMemory: true }` so the whole graph stands up in memory with no
 * files written (decision 11).
 */
export abstract class IDatabaseOptions {
  public abstract readonly inMemory: boolean;
}
