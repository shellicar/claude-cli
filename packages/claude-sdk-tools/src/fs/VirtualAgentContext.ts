import { IAgentContext } from '@shellicar/claude-core/fs/IAgentContext';

/**
 * A simulated shell: tracks cwd as a plain string and never touches the real
 * process. This is what a subagent gets — it shares the parent's env at
 * construction time (a snapshot, not a live link) but moves independently, so
 * its `chdir` can never affect the parent or any sibling subagent.
 */
export class VirtualAgentContext extends IAgentContext {
  #cwd: string;
  readonly #env: Readonly<Record<string, string | undefined>>;

  public constructor(initialCwd: string, env: Readonly<Record<string, string | undefined>> = process.env) {
    super();
    this.#cwd = initialCwd;
    this.#env = env;
  }

  public cwd(): string {
    return this.#cwd;
  }

  public chdir(path: string): void {
    this.#cwd = path;
  }

  public getEnvVar(name: string): string | undefined {
    return this.#env[name];
  }
}
