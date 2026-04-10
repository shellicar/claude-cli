import { ClientId, TokenUrl } from './consts';
import { InvalidAuthorisationCodeError } from './InvalidAuthorisationCodeError';
import { parseTokenResponse } from './parseTokenResponse';
import { TokenExchangeFailedError } from './TokenExchangeFailedError';
import type { AuthCredentials } from './types';

export const exchangeCode = async (code: string, state: string, codeVerifier: string, redirectUri: string): Promise<AuthCredentials> => {
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

  return parseTokenResponse(await response.json());
};
