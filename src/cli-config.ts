import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const cliConfigSchema = z
  .object({
    $schema: z.string().optional().describe('JSON Schema reference for editor autocomplete'),
    model: z.string().optional().default('claude-opus-4-6').catch('claude-opus-4-6').describe('Claude model to use for queries'),
    maxTurns: z.int().min(1).optional().default(100).catch(100).describe('Maximum number of agentic turns per query'),
    permissionTimeoutMs: z.int().min(1000).optional().default(30_000).catch(30_000).describe('Timeout in milliseconds for standard tool permission prompts'),
    extendedPermissionTimeoutMs: z.int().min(1000).optional().default(120_000).catch(120_000).describe('Timeout in milliseconds for extended permission prompts (e.g. EnterPlanMode, ExitPlanMode)'),
    drowningThreshold: z.int().min(0).nullable().optional().default(15).catch(15).describe('Seconds remaining on permission timer before the drowning alert (flashing + beep). Set to null to disable.'),
    autoApproveEdits: z.boolean().optional().default(true).catch(true).describe('Auto-approve Edit and Write tools for files inside the working directory'),
    autoApproveReads: z.boolean().optional().default(true).catch(true).describe('Auto-approve read-only tools (Read, Glob, Grep, LS, Skill) without prompting'),
  })
  .meta({ title: 'Claude CLI Configuration', description: 'Configuration for @shellicar/claude-cli' });

export type ResolvedCliConfig = Omit<z.infer<typeof cliConfigSchema>, '$schema'>;

export const CONFIG_PATH = resolve(homedir(), '.claude', 'cli-config.json');

const SCHEMA_URL = 'https://raw.githubusercontent.com/shellicar/claude-cli/main/schema/cli-config.schema.json';

const STRIP_KEYS = new Set(['required', 'additionalProperties']);

function cleanSchema(obj: unknown, isRoot = false): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => cleanSchema(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'maximum' && value === Number.MAX_SAFE_INTEGER) {
        continue;
      }
      if (isRoot && STRIP_KEYS.has(key)) {
        continue;
      }
      result[key] = cleanSchema(value);
    }
    return result;
  }
  return obj;
}

export function generateJsonSchema(): Record<string, unknown> {
  const raw = cliConfigSchema.toJSONSchema({ target: 'draft-07' });
  return cleanSchema(raw, true) as Record<string, unknown>;
}

/** @private Exported for testing only. */
export function parseCliConfig(raw: unknown): ResolvedCliConfig {
  return cliConfigSchema.parse(raw);
}

export function loadCliConfig(): { config: ResolvedCliConfig; warnings: string[]; path: string | null } {
  const defaults = cliConfigSchema.parse({});

  if (!existsSync(CONFIG_PATH)) {
    return { config: defaults, warnings: [], path: null };
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const config = cliConfigSchema.parse(raw);
    return { config, warnings: [], path: CONFIG_PATH };
  } catch {
    return { config: defaults, warnings: [`Failed to parse ${CONFIG_PATH}`], path: CONFIG_PATH };
  }
}

export function initConfig(log: (msg: string) => void): void {
  if (existsSync(CONFIG_PATH)) {
    log(`Config already exists at ${CONFIG_PATH}`);
    return;
  }

  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const defaults = cliConfigSchema.parse({});
  const content = JSON.stringify(
    {
      $schema: SCHEMA_URL,
      model: defaults.model,
      maxTurns: defaults.maxTurns,
      permissionTimeoutMs: defaults.permissionTimeoutMs,
      extendedPermissionTimeoutMs: defaults.extendedPermissionTimeoutMs,
      drowningThreshold: defaults.drowningThreshold,
      autoApproveEdits: defaults.autoApproveEdits,
      autoApproveReads: defaults.autoApproveReads,
    },
    null,
    2,
  );

  writeFileSync(CONFIG_PATH, `${content}\n`);
  log(`Created config at ${CONFIG_PATH}`);
}
