import { writeFile } from 'node:fs/promises';
import { credentialsPath } from './credentialsPath';
import { authCredentials } from './schema';
import type { AuthCredentials } from './types';

export const saveCredentials = async (credentials: AuthCredentials): Promise<void> => {
  const value = authCredentials.parse(credentials);
  const path = credentialsPath();
  await writeFile(path, JSON.stringify(value, null, 2));
};
