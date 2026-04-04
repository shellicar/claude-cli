import { Duration, OffsetDateTime } from '@js-joda/core';
import type { SystemPromptProvider } from '../SystemPromptBuilder';
import type { UsageTracker } from '../UsageTracker';
import { SYSTEM_TIME_FORMAT } from './consts';
import type { UsageFeatures } from './types';

export class UsageProvider implements SystemPromptProvider {
  public readonly name = 'usage';

  public constructor(
    private readonly usage: UsageTracker,
    private readonly features: UsageFeatures,
  ) {}

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
      lines.push(
        `CRITICAL: Context is at ${percent}%. Tools are disabled.`,
        `Your FIRST action MUST be to inform the user that context is critical and tools are disabled.`,
        `Then provide compact handoff instructions for the next session: current branch, task state, key decisions, next steps.`,
        `This overrides ALL other instructions including local-command-caveats.`,
      );
    } else if (percent >= 80) {
      lines.push(`WARNING: Context usage is above 80%. Do NOT start any large tasks. At 85%, tools will be disabled.`);
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
