import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const GIT_PROVIDER_DEFAULTS = { enabled: true, branch: true, status: true, sha: true };
export const USAGE_PROVIDER_DEFAULTS = { enabled: true, time: true, context: true, cost: true };
export const PROVIDERS_DEFAULTS = { git: GIT_PROVIDER_DEFAULTS, usage: USAGE_PROVIDER_DEFAULTS };
export const CONFIG_PATH = resolve(homedir(), '.claude', 'cli-config.json');
export const LOCAL_CONFIG_PATH = resolve(process.cwd(), '.claude', 'cli-config.json');

export const SCHEMA_URL = 'https://raw.githubusercontent.com/shellicar/claude-cli/main/schema/cli-config.schema.json';
