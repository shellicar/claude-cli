import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG_PATH, SCHEMA_URL } from './consts';
import { sdkConfigSchema } from './schema';

export const defaultConfig = () => {
  const defaults = sdkConfigSchema.parse({});
  return {
    $schema: SCHEMA_URL,
    ...defaults,
  };
};

export function initConfig(log: (msg: string) => void): void {
  if (existsSync(CONFIG_PATH)) {
    log(`Config already exists at ${CONFIG_PATH}`);
    return;
  }

  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(defaultConfig(), undefined, 2);

  writeFileSync(CONFIG_PATH, `${content}\n`);
  log(`Created config at ${CONFIG_PATH}`);
}
