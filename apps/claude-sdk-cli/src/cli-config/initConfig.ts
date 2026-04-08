import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG_PATH, SCHEMA_URL } from './consts';
import { sdkConfigSchema } from './schema';

export function initConfig(log: (msg: string) => void): void {
  if (existsSync(CONFIG_PATH)) {
    log(`Config already exists at ${CONFIG_PATH}`);
    return;
  }

  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const defaults = sdkConfigSchema.parse({});
  const content = JSON.stringify(
    {
      $schema: SCHEMA_URL,
      model: defaults.model,
      historyReplay: defaults.historyReplay,
    },
    null,
    2,
  );

  writeFileSync(CONFIG_PATH, `${content}\n`);
  log(`Created config at ${CONFIG_PATH}`);
}
