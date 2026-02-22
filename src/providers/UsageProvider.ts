import { Duration, OffsetDateTime } from '@js-joda/core';
import type { SystemPromptProvider } from '../SystemPromptBuilder';
import type { UsageTracker } from '../UsageTracker';
import { DEFAULT_USAGE_FEATURES, SYSTEM_TIME_FORMAT } from './consts';
import type { UsageFeatures } from './types';

export class UsageProvider implements SystemPromptProvider {
  public readonly name = 'usage';
  public readonly enabled: boolean;
  private readonly features: UsageFeatures;

  public constructor(
    private readonly usage: UsageTracker,
    enabled = true,
    features: Partial<UsageFeatures> = {},
  ) {
    this.enabled = enabled;
    this.features = { ...DEFAULT_USAGE_FEATURES, ...features };
  }

  public async getSections(): Promise<Array<string | undefined>> {
    return [this.features.time ? this.buildTime() : undefined, this.features.context ? this.buildContext() : undefined, this.features.cost ? this.buildCost() : undefined];
  }

  private buildTime(): string {
    const now = OffsetDateTime.now();
    const lastResult = this.usage.lastResultTime;
    const sinceLast = lastResult ? `${Duration.between(lastResult, now).seconds()}s since last response` : 'first message';
    return `# currentTime\n${now.format(SYSTEM_TIME_FORMAT)} (${sinceLast})\nIf significant time has passed, re-read files and re-check state rather than relying on previous tool output.`;
  }

  private buildContext(): string | undefined {
    const ctx = this.usage.context;
    if (!ctx) {
      return undefined;
    }
    return `# contextUsage\nContext: ${ctx.used}/${ctx.window}\nThis is updated every user message with the latest token count from the previous assistant response.`;
  }

  private buildCost(): string | undefined {
    const cost = this.usage.sessionCost;
    if (cost <= 0) {
      return undefined;
    }
    return `# sessionCost\nSession: $${cost.toFixed(4)}`;
  }
}
