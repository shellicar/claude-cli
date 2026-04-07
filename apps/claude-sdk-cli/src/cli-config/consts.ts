import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const CONFIG_PATH = resolve(homedir(), '.claude', 'sdk-config.json');
export const LOCAL_CONFIG_PATH = resolve(process.cwd(), '.claude', 'sdk-config.json');

export const SCHEMA_URL = 'https://raw.githubusercontent.com/shellicar/claude-cli/main/schema/sdk-config.schema.json';
