import { appendFileSync } from 'node:fs';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const SKIP_TYPES = new Set(['stream_event']);

export class AuditWriter {
  public constructor(private readonly filePath: string) {}

  public write(msg: SDKMessage): void {
    if (SKIP_TYPES.has(msg.type)) {
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
