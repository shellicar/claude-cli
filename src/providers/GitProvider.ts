import type { SystemPromptProvider } from '../SystemPromptBuilder';
import { DEFAULT_GIT_FEATURES } from './consts';
import { execFileAsync } from './execFileAsync';
import type { GitFeatures } from './types';

export class GitProvider implements SystemPromptProvider {
  public readonly name = 'git';
  public readonly enabled: boolean;
  private readonly features: GitFeatures;

  public constructor(enabled = true, features: Partial<GitFeatures> = {}) {
    this.enabled = enabled;
    this.features = { ...DEFAULT_GIT_FEATURES, ...features };
  }

  public async getSections(): Promise<Array<string | undefined>> {
    return [this.features.branch ? await this.buildBranch() : undefined, this.features.status ? await this.buildStatus() : undefined];
  }

  private async buildBranch(): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
        timeout: 3000,
        encoding: 'utf8',
      });
      const branch = stdout.trim();
      if (!branch) {
        return undefined;
      }
      return `# gitBranch\n${branch}`;
    } catch {
      return undefined;
    }
  }

  private async buildStatus(): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        timeout: 3000,
        encoding: 'utf8',
      });
      const dirty = stdout.trim().length > 0;
      return `# gitStatus\nWorking tree: ${dirty ? 'dirty' : 'clean'}`;
    } catch {
      return undefined;
    }
  }
}
