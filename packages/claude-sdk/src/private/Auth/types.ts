export type AnthropicAuthOptions = {
  redirect?: 'local' | 'manual';
};
export type AuthUrlResult = {
  url: string;
  codeVerifier: string;
  state: string;
};
export type AuthCredentials = {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
  };
};
