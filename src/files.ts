import { accessSync, existsSync, mkdirSync, readdirSync, writeFileSync, constants } from 'node:fs';
import { homedir } from 'node:os';
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

export type SkillSource = 'user' | 'project';

export interface SkillInfo {
  name: string;
  source: SkillSource;
}

/** @see https://platform.claude.com/docs/en/agent-sdk/skills */
const SKILL_DIRS: { source: SkillSource; dir: string }[] = [
  { source: 'user', dir: resolve(homedir(), '.claude', 'skills') },
  { source: 'project', dir: resolve(process.cwd(), '.claude', 'skills') },
];

export function discoverSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];

  for (const { source, dir } of SKILL_DIRS) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const skillFile = resolve(dir, entry.name, 'SKILL.md');
        if (existsSync(skillFile)) {
          skills.push({ name: entry.name, source });
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return skills;
}
