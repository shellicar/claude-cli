import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { parseGitRemote } from '@shellicar/claude-core/memory/environment';
import { IMemoryEnvironmentProvider } from '@shellicar/claude-core/memory/environment-provider';
import type { MemoryEnvironment } from '@shellicar/claude-core/memory/types';
import { dependsOn } from '@shellicar/core-di-lite';

const execFileAsync = promisify(execFile);

async function readGitRemote(): Promise<MemoryEnvironment> {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url']);
    return parseGitRemote(stdout);
  } catch {
    return {};
  }
}

export class GitMemoryEnvironmentProvider extends IMemoryEnvironmentProvider {
  @dependsOn(ConfigLoader)
  public configLoader!: ConfigLoader<any>;

  public async resolve(): Promise<MemoryEnvironment> {
    const memory = this.configLoader.config.memory;
    const git = memory.git.enabled ? await readGitRemote() : {};
    return { ...memory.environment, ...git };
  }
}
