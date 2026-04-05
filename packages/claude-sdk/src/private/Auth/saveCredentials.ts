import { writeFile } from 'node:fs/promises';
import { CredentialsPath } from './consts';
import type { AuthCredentials } from './types';

export const saveCredentials = async (credentials: AuthCredentials): Promise<void> => {
  await writeFile(CredentialsPath, JSON.stringify(credentials, null, 2));
};
