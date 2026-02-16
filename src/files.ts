import { accessSync, mkdirSync, writeFileSync, constants } from 'node:fs';
import { resolve } from 'node:path';

export interface CliPaths {
  claudeDir: string;
  auditFile: string;
  sessionFile: string;
}

export function initFiles(): CliPaths {
  const claudeDir = resolve(process.cwd(), '.claude');
  const auditFile = resolve(claudeDir, 'audit.jsonl');
  const sessionFile = resolve(claudeDir, 'cli-session');

  try {
    mkdirSync(claudeDir, { recursive: true });
  } catch (err) {
    console.error(`FATAL: Cannot create directory ${claudeDir}: ${err}`);
    process.exit(1);
  }

  // Ensure audit file exists and is writable
  try {
    try {
      accessSync(auditFile, constants.W_OK);
    } catch {
      writeFileSync(auditFile, '');
    }
    accessSync(auditFile, constants.W_OK);
  } catch (err) {
    console.error(`FATAL: Cannot write to audit log at ${auditFile}: ${err}`);
    process.exit(1);
  }

  return { claudeDir, auditFile, sessionFile };
}
