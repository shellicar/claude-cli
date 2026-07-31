import { Clock } from '@js-joda/core';
import { dependsOn } from '@shellicar/core-di';
import { ICredentialProvider, ICredentialStore, ITokenEndpoint } from './interfaces';
import { NotAuthenticatedError } from './NotAuthenticatedError';
import type { AuthCredentials } from './types';

export class CredentialProvider extends ICredentialProvider {
  @dependsOn(ICredentialStore) private readonly store!: ICredentialStore;
  @dependsOn(ITokenEndpoint) private readonly tokens!: ITokenEndpoint;
  @dependsOn(Clock) private readonly clock!: Clock;

  public async get(): Promise<AuthCredentials> {
    const stored = await this.store.read();
    if (stored === null) {
      throw new NotAuthenticatedError();
    }
    if (stored.claudeAiOauth.expiresAt > this.clock.millis()) {
      return stored;
    }
    const refreshed = await this.tokens.refresh(stored);
    await this.store.write(refreshed);
    return refreshed;
  }
}
