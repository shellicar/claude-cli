import type { AuthCredentials } from './types';

export const isExpired = (credentials: AuthCredentials): boolean => Date.now() >= credentials.claudeAiOauth.expiresAt;
