import { IAgentContext } from '@shellicar/claude-core/fs/IAgentContext';

/**
 * The real shell: reads and moves the OS process's actual cwd/env. There is only
 * one process, so only one session may hold this — the top-level session. A
 * subagent must never be given this; it would move the parent's cwd too.
 */
export class PhysicalAgentContext extends IAgentContext {
  public cwd(): string {
    return process.cwd();
  }

  public chdir(path: string): void {
    process.chdir(path);
  }

  public getEnvVar(name: string): string | undefined {
    return process.env[name];
  }
}
