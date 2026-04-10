import { AuthorisationUrl, ClientId, Scopes } from './consts';
import { generateCodeChallenge } from './generateCodeChallenge';
import { generateCodeVerifier } from './generateCodeVerifier';
import { generateState } from './generateState';
import type { AuthUrlResult } from './types';

export const buildAuthUrl = (redirectUri: string): AuthUrlResult => {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  const url = new URL(AuthorisationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', ClientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', Scopes);
  url.searchParams.set('code_challenge', generateCodeChallenge(codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);

  return { url: url.href, codeVerifier, state } satisfies AuthUrlResult;
};
