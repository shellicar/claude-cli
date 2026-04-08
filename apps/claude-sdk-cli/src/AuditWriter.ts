import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SdkMessage } from '@shellicar/claude-sdk';

const dir = join(homedir(), '.claude', 'audit');
mkdirSync(dir, { recursive: true });
const path = join(dir, 'audit.jsonl');

export function writeAuditEvent(msg: SdkMessage): void {
  const entry = { timestamp: new Date().toISOString(), ...msg };
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}
