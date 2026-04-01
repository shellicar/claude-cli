import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const SKIP_TYPES = new Set(['stream_event']);

export class AuditWriter {
  private filePath: string | undefined;

  public constructor(private readonly auditDir: string) {}

  public setSessionId(sessionId: string): void {
    this.filePath = resolve(this.auditDir, `${sessionId}.jsonl`);
  }

  public write(msg: SDKMessage): void {
    if (SKIP_TYPES.has(msg.type)) {
      return;
    }
    if (!this.filePath) {
      return;
    }
    try {
      const entry = { timestamp: new Date().toISOString(), ...msg };
      appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
    } catch (err) {
      console.error(`FATAL: Failed to write audit log to ${this.filePath}: ${err}`);
      process.exit(1);
    }
  }
}
