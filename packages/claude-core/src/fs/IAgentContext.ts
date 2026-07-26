/**
 * The per-agent-session state that is not shared across two live agents in the
 * same process — the equivalent of what differs between two open shells on the
 * same machine (cwd, env vars), as opposed to the filesystem/platform underneath
 * both, which IFileSystem still owns and which stays a process-wide singleton.
 */
export abstract class IAgentContext {
  public abstract cwd(): string;
  /** Move the working directory. The authoritative move: everything reading `cwd()` live follows it. */
  public abstract chdir(path: string): void;
  public abstract getEnvVar(name: string): string | undefined;
}
