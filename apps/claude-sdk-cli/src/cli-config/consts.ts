import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const CONFIG_PATH = resolve(homedir(), '.claude', 'sdk-config.json');

/**
 * The project-local config path, resolved against the *current* working
 * directory on every call. Read live (not captured at module load) so that
 * after the session moves it points at the new directory's config.
 */
export const localConfigPath = (): string => resolve(process.cwd(), '.claude', 'sdk-config.json');

export const SCHEMA_URL = 'https://raw.githubusercontent.com/shellicar/claude-cli/main/schema/sdk-config.schema.json';
