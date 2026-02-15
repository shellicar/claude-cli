import { accessSync, appendFileSync, writeFileSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const AUDIT_FILE = resolve(process.cwd(), 'audit.jsonl');

export function initAudit(): string {
  try {
    // Create if it doesn't exist, otherwise just check write access
    try {
      accessSync(AUDIT_FILE, constants.W_OK);
    } catch {
      writeFileSync(AUDIT_FILE, '');
    }
    // Verify we can actually write
    accessSync(AUDIT_FILE, constants.W_OK);
  } catch (err) {
    console.error(`FATAL: Cannot write to audit log at ${AUDIT_FILE}: ${err}`);
    process.exit(1);
  }
  return AUDIT_FILE;
}

const SKIP_AUDIT_TYPES = new Set(['stream_event']);

export function writeAuditEntry(msg: SDKMessage): void {
  if (SKIP_AUDIT_TYPES.has(msg.type)) return;
  try {
    const entry = { timestamp: new Date().toISOString(), ...msg };
    appendFileSync(AUDIT_FILE, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    console.error(`FATAL: Failed to write audit log to ${AUDIT_FILE}: ${err}`);
    process.exit(1);
  }
}
