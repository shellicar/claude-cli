import { homedir } from 'node:os';
import { join } from 'node:path';
import { CredentialsPath } from './consts';

export function credentialsPath() {
  return join(homedir(), '.claude', CredentialsPath);
}
