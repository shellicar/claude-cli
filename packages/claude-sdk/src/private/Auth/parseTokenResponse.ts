import { tokenResponse } from './schema';
import type { AuthCredentials } from './types';

export const parseTokenResponse = (input: unknown): AuthCredentials => {
  const data = tokenResponse.parse(input);
  return {
    claudeAiOauth: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scopes: data.scope,
    },
  } satisfies AuthCredentials;
};
