import { closeSync, createReadStream, openSync, readSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

export interface ContextUsage {
  readonly used: number;
  readonly window: number;
  readonly percent: number;
}

export interface LastAssistantInfo {
  readonly uuid: string;
}

interface AuditUsage {
  readonly input_tokens: number;
  readonly cache_creation_input_tokens: number;
  readonly cache_read_input_tokens: number;
  readonly output_tokens: number;
}

/** Read the last chunk of a file and return lines in reverse order. */
function readTail(filePath: string, chunkSize = 256 * 1024): string[] {
  const { size } = statSync(filePath);
  if (size === 0) {
    return [];
  }

  const fd = openSync(filePath, 'r');
  try {
    const readFrom = Math.max(0, size - chunkSize);
    const readLength = size - readFrom;
    const buf = Buffer.alloc(readLength);
    readSync(fd, buf, 0, readLength, readFrom);

    const text = buf.toString('utf8');
    const lines = text.trimEnd().split('\n');

    // If we didn't read from the start, the first line may be partial — drop it
    if (readFrom > 0) {
      lines.shift();
    }

    lines.reverse();
    return lines;
  } finally {
    closeSync(fd);
  }
}

export class UsageTracker {
  private processedMessageIds = new Set<string>();
  private lastAssistantUsage: AuditUsage | undefined;
  private lastContextWindow = 0;
  private cumulativeCost = 0;
  private _lastAssistantUuid: string | undefined;

  /** Load context usage from the tail of the audit file (sync, fast, 256KB). */
  public loadContextFromAudit(auditFile: string, sessionId: string): void {
    try {
      const lines = readTail(auditFile);
      for (const line of lines) {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.session_id !== sessionId) {
          continue;
        }

        if (entry.type === 'result' && entry.subtype === 'success' && !this.lastContextWindow) {
          const modelUsage = entry.modelUsage as Record<string, { contextWindow: number }> | undefined;
          if (modelUsage) {
            for (const mu of Object.values(modelUsage)) {
              if (mu.contextWindow > this.lastContextWindow) {
                this.lastContextWindow = mu.contextWindow;
              }
            }
          }
        }

        if (entry.type === 'assistant' && !this.lastAssistantUsage) {
          const message = entry.message as { usage?: AuditUsage } | undefined;
          if (message?.usage) {
            this.lastAssistantUsage = message.usage;
          }
          if (!this._lastAssistantUuid && typeof entry.uuid === 'string') {
            this._lastAssistantUuid = entry.uuid;
          }
        }

        // Once we have both, no need to continue
        if (this.lastAssistantUsage && this.lastContextWindow) {
          break;
        }
      }
    } catch {
      // Audit file missing or corrupt — start fresh
    }
  }

  /** Load cumulative session cost from the full audit file (async, streaming). */
  public async loadCostFromAudit(auditFile: string, sessionId: string): Promise<void> {
    try {
      statSync(auditFile);
    } catch {
      return;
    }

    const rl = createInterface({
      input: createReadStream(auditFile, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.session_id !== sessionId) {
          continue;
        }
        if (entry.type === 'result' && entry.subtype === 'success') {
          const costUsd = entry.total_cost_usd;
          if (typeof costUsd === 'number') {
            this.cumulativeCost += costUsd;
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  public onMessage(msg: SDKMessage): void {
    if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
      this.lastAssistantUsage = undefined;
      return;
    }
    if (msg.type !== 'assistant') {
      return;
    }
    this._lastAssistantUuid = msg.uuid;
    const { id, usage } = msg.message;
    if (!usage || this.processedMessageIds.has(id)) {
      return;
    }
    this.processedMessageIds.add(id);
    this.lastAssistantUsage = usage;
  }

  public onResult(msg: SDKResultMessage): void {
    this.cumulativeCost += msg.total_cost_usd;

    // Extract context window from modelUsage (use the largest, typically the primary model)
    for (const mu of Object.values(msg.modelUsage)) {
      if (mu.contextWindow > this.lastContextWindow) {
        this.lastContextWindow = mu.contextWindow;
      }
    }

    this.processedMessageIds.clear();
  }

  public get sessionCost(): number {
    return this.cumulativeCost;
  }

  public get lastAssistant(): LastAssistantInfo | undefined {
    if (!this._lastAssistantUuid) {
      return undefined;
    }
    return { uuid: this._lastAssistantUuid };
  }

  public get context(): ContextUsage | undefined {
    if (!this.lastAssistantUsage) {
      return undefined;
    }
    const u = this.lastAssistantUsage;
    const used = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
    const window = this.lastContextWindow || 200_000;
    const percent = (used / window) * 100;
    return { used, window, percent };
  }
}
