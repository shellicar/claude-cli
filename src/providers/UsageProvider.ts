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
    const percent = Math.round(ctx.percent);
    const lines = [`# contextUsage`, `Context: ${percent}% used`];
    if (percent >= 85) {
      lines.push(`STOP. Context is at ${percent}%. You MUST end your response with compact preparation.`, `1. Respond to the user's message normally`, `2. Then write compact instructions: current branch, task state, key decisions, next steps`, `This is MANDATORY.`);
    } else if (percent >= 80) {
      lines.push(`WARNING: Context usage is above 80%. Do NOT start any large tasks.`);
    }
    return lines.join('\n');
  }

  private buildCost(): string | undefined {
    const cost = this.usage.sessionCost;
    if (cost <= 0) {
      return undefined;
    }
    return `# sessionCost\nSession: $${cost.toFixed(4)}`;
  }
}
