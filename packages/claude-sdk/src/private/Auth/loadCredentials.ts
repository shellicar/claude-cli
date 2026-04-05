import { readFile } from 'node:fs/promises';
import { CredentialsPath } from './consts';
import type { AuthCredentials } from './types';

export const loadCredentials = async (): Promise<AuthCredentials | null> => {
  try {
    const raw = await readFile(CredentialsPath, 'utf-8');
    const parsed: AuthCredentials = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
};
