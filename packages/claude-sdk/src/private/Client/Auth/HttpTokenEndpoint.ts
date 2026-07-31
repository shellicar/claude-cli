import { Clock } from '@js-joda/core';
import { dependsOn } from '@shellicar/core-di';
import { ClientId, TokenUrl } from './consts';
import { InvalidAuthorisationCodeError } from './InvalidAuthorisationCodeError';
import { ITokenEndpoint } from './interfaces';
import { parseTokenResponse } from './parseTokenResponse';
import { TokenExchangeFailedError } from './TokenExchangeFailedError';
import type { AuthCredentials } from './types';

export class HttpTokenEndpoint extends ITokenEndpoint {
  @dependsOn(Clock) private readonly clock!: Clock;

  public async exchangeCode(code: string, state: string, codeVerifier: string, redirectUri: string): Promise<AuthCredentials> {
    const response = await fetch(TokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: ClientId,
        code_verifier: codeVerifier,
        state,
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new InvalidAuthorisationCodeError();
      }
      throw new TokenExchangeFailedError();
    }

    return parseTokenResponse(await response.json(), this.clock.millis());
  }

  public async refresh(credentials: AuthCredentials): Promise<AuthCredentials> {
    const response = await fetch(TokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: credentials.claudeAiOauth.refreshToken,
        client_id: ClientId,
      }),
    });

    if (!response.ok) {
      throw new TokenExchangeFailedError();
    }

    return parseTokenResponse(await response.json(), this.clock.millis());
  }
}
