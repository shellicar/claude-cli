import { chmod, readFile, writeFile } from 'node:fs/promises';
import { credentialsPath } from './credentialsPath';
import { ICredentialStore } from './interfaces';
import { authCredentials } from './schema';
import type { AuthCredentials } from './types';

export class FileCredentialStore extends ICredentialStore {
  public async read(): Promise<AuthCredentials | null> {
    try {
      const raw = await readFile(credentialsPath(), 'utf-8');
      return authCredentials.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  public async write(credentials: AuthCredentials): Promise<void> {
    const value = authCredentials.parse(credentials);
    const path = credentialsPath();
    await writeFile(path, JSON.stringify(value, null, 2));
    // writeFile's mode option only applies when creating a new file, so an explicit chmod is needed to
    // also lock down a credentials file that already existed before this write with looser permissions.
    await chmod(path, 0o600);
  }
}
