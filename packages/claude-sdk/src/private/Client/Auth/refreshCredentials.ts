import { ClientId, TokenUrl } from './consts';
import { parseTokenResponse } from './parseTokenResponse';
import { TokenExchangeFailedError } from './TokenExchangeFailedError';
import type { AuthCredentials } from './types';

export const refreshCredentials = async (credentials: AuthCredentials): Promise<AuthCredentials> => {
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

  return parseTokenResponse(await response.json());
};
