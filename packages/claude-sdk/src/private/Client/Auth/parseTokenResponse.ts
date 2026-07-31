import { tokenResponse } from './schema';
import type { AuthCredentials } from './types';

export const parseTokenResponse = (input: unknown, nowMillis: number): AuthCredentials => {
  const data = tokenResponse.parse(input);
  return {
    claudeAiOauth: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: nowMillis + data.expires_in * 1000,
      scopes: data.scope,
      subscriptionType: '',
      rateLimitTier: '',
    },
  } satisfies AuthCredentials;
};
