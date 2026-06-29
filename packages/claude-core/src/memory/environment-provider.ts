import type { MemoryEnvironment } from './types';

/** Resolves the environment bag to stamp on a memory, at the moment of writing. Implementations read whatever ambient signal (git remote, config) is in effect on each call. */
export abstract class IMemoryEnvironmentProvider {
  public abstract resolve(): Promise<MemoryEnvironment>;
}
