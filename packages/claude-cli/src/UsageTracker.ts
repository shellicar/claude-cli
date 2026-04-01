import { closeSync, createReadStream, openSync, readSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BetaContentBlock, BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages';
import { OffsetDateTime } from '@js-joda/core';

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
  readonly cache_creation_input_tokens: number | null;
  readonly cache_read_input_tokens: number | null;
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

interface AuditContextScan {
  readonly assistantUsage: AuditUsage | undefined;
  readonly contextWindow: number;
  readonly assistantUuid: string | undefined;
}

function scanContextFromLines(lines: string[], sessionId: string): AuditContextScan {
  let assistantUsage: AuditUsage | undefined;
  let contextWindow = 0;
  let assistantUuid: string | undefined;
  for (const line of lines) {
    const entry = JSON.parse(line) as SDKMessage;
    if (entry.session_id !== sessionId) {
      continue;
    }
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      break;
    }
    if (entry.type === 'result' && entry.subtype === 'success' && !contextWindow) {
      const modelUsage = entry.modelUsage;
      if (modelUsage) {
        for (const mu of Object.values(modelUsage)) {
          if (mu.contextWindow > contextWindow) {
            contextWindow = mu.contextWindow;
          }
        }
      }
    }
    if (entry.type === 'assistant' && !assistantUsage) {
      const message = entry.message;
      if (message.usage) {
        assistantUsage = message.usage;
      }
      if (assistantUuid == null) {
        assistantUuid = entry.uuid;
      }
    }
    if (assistantUsage && contextWindow) {
      break;
    }
  }
  return { assistantUsage, contextWindow, assistantUuid };
}

export interface TodoItem {
  readonly content: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
  readonly activeForm?: string;
}

type TodoWriteBlock = BetaToolUseBlock & { input: { todos: TodoItem[] } };

const isTodoToolUse = (block: BetaToolUseBlock): block is TodoWriteBlock => {
  return block.name === 'TodoWrite';
};

const isToolUse = (block: BetaContentBlock): block is BetaToolUseBlock => {
  return block.type === 'tool_use';
};

export function readLastTodoWrite(auditFile: string, sessionId: string): readonly TodoItem[] | undefined {
  try {
    const lines = readTail(auditFile);
    for (const line of lines) {
      const entry = JSON.parse(line) as SDKMessage;
      if (entry.session_id !== sessionId) {
        continue;
      }
      if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
        break;
      }
      if (entry.type === 'assistant') {
        const content = entry.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (isToolUse(block) && isTodoToolUse(block)) {
              return block.input.todos;
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

export class UsageTracker {
  private processedMessageIds = new Set<string>();
  private lastAssistantUsage: AuditUsage | undefined;
  private lastContextWindow = 0;
  private primaryModel: string | undefined;
  private cumulativeCost = 0;
  private _lastAssistantUuid: string | undefined;
  private _lastResultTime: OffsetDateTime | undefined;

  /** Load context usage from the tail of the audit file (sync, fast, 256KB). */
  public loadContextFromAudit(auditFile: string, sessionId: string): void {
    try {
      const lines = readTail(auditFile);
      const result = scanContextFromLines(lines, sessionId);
      if (result.assistantUsage) {
        this.lastAssistantUsage = result.assistantUsage;
      }
      if (result.contextWindow) {
        this.lastContextWindow = result.contextWindow;
      }
      if (result.assistantUuid) {
        this._lastAssistantUuid = result.assistantUuid;
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
        const entry = JSON.parse(line) as SDKMessage;
        if (entry.session_id !== sessionId) {
          continue;
        }
        if (entry.type === 'result' && entry.subtype === 'success') {
          const costUsd = entry.total_cost_usd;
          this.cumulativeCost += costUsd;
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  public reset(): void {
    this.processedMessageIds.clear();
    this.lastAssistantUsage = {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
    };
    this.cumulativeCost = 0;
    this.primaryModel = undefined;
    this._lastAssistantUuid = undefined;
    this._lastResultTime = undefined;
  }

  public onMessage(msg: SDKMessage): void {
    if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
      this.lastAssistantUsage = undefined;
      return;
    }
    if (msg.type === 'system' && msg.subtype === 'init') {
      this.primaryModel = msg.model;
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
    this._lastResultTime = OffsetDateTime.now();
    this.cumulativeCost += msg.total_cost_usd;

    const contextWindow = this.primaryModel ? msg.modelUsage[this.primaryModel]?.contextWindow : undefined;
    if (contextWindow) {
      this.lastContextWindow = contextWindow;
    }

    this.processedMessageIds.clear();
  }

  public get sessionCost(): number {
    return this.cumulativeCost;
  }

  public get lastResultTime(): OffsetDateTime | undefined {
    return this._lastResultTime;
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
    const used = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + u.output_tokens;
    const window = this.lastContextWindow || 200_000;
    const percent = (used / window) * 100;
    return { used, window, percent };
  }
}
