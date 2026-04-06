import { readFile } from 'node:fs/promises';
import { credentialsPath } from './credentialsPath';
import { authCredentials } from './schema';
import type { AuthCredentials } from './types';

export const loadCredentials = async (): Promise<AuthCredentials | null> => {
  try {
    const path = credentialsPath();
    const raw = await readFile(path, 'utf-8');
    const parsed = authCredentials.parse(JSON.parse(raw));
    return parsed;
  } catch {
    return null;
  }
};
