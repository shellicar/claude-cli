import { chmod, writeFile } from 'node:fs/promises';
import { credentialsPath } from './credentialsPath';
import { authCredentials } from './schema';
import type { AuthCredentials } from './types';

export const saveCredentials = async (credentials: AuthCredentials): Promise<void> => {
  const value = authCredentials.parse(credentials);
  const path = credentialsPath();
  await writeFile(path, JSON.stringify(value, null, 2));
  // writeFile's mode option only applies when creating a new file, so an explicit chmod is needed to
  // also lock down a credentials file that already existed before this write with looser permissions.
  await chmod(path, 0o600);
};
