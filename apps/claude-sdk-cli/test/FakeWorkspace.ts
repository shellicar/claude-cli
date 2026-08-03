import { IWorkspace, type Refusal } from '../src/workspace/Workspace.js';

/**
 * A scratchpad that is simply present or absent. Creating and verifying a real directory is
 * `Workspace`'s own business and has its own tests; every other spec only needs the seam filled so
 * the class under test resolves, and a change to the config shape or to how a conversation id is
 * minted cannot fail a spec that tests neither.
 */
export class FakeWorkspace extends IWorkspace {
  readonly #root: string | null;
  readonly #refusal: Refusal | null;

  public constructor(options: { root?: string | null; refusal?: Refusal | null } = {}) {
    super();
    this.#root = options.root ?? null;
    this.#refusal = options.refusal ?? null;
  }

  public root(): string | null {
    return this.#root;
  }

  public contains(path: string): boolean {
    return this.#root != null && path.startsWith(`${this.#root}/`);
  }

  public containsForDelete(path: string): boolean {
    return this.contains(path);
  }

  public resolve(): Promise<Refusal | null> {
    return Promise.resolve(this.#refusal);
  }
}
