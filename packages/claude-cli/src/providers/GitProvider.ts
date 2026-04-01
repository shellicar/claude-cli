import type { SystemPromptProvider } from '../SystemPromptBuilder';
import { execFileAsync } from './execFileAsync';
import type { GitFeatures } from './types';

export class GitProvider implements SystemPromptProvider {
  public readonly name = 'git';

  public constructor(private readonly features: GitFeatures) {}

  public async getSections(): Promise<Array<string | undefined>> {
    return [this.features.branch ? await this.buildBranch() : undefined, this.features.sha ? await this.buildSha() : undefined, this.features.status ? await this.buildStatus() : undefined];
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

  private async buildSha(): Promise<string | undefined> {
    try {
      const { stdout: sha } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
        timeout: 3000,
        encoding: 'utf8',
      });
      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], {
        timeout: 3000,
        encoding: 'utf8',
      });
      const dirty = status.trim().length > 0;
      return `# gitSha\n${sha.trim()}${dirty ? '-dirty' : ''}`;
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
