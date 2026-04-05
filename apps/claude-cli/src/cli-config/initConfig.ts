import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG_PATH, SCHEMA_URL } from './consts';
import { cliConfigSchema } from './schema';

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
      questionTimeoutMs: defaults.questionTimeoutMs,
      drowningThreshold: defaults.drowningThreshold,
      autoApproveEdits: defaults.autoApproveEdits,
      autoApproveReads: defaults.autoApproveReads,
      expandTilde: defaults.expandTilde,
      providers: defaults.providers,
    },
    null,
    2,
  );

  writeFileSync(CONFIG_PATH, `${content}\n`);
  log(`Created config at ${CONFIG_PATH}`);
}
