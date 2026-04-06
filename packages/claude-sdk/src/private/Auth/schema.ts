import { z } from 'zod';

export const tokenResponse = z.object({
  token_type: z.string(),
  access_token: z.string(),
  expires_in: z.number().int(),
  refresh_token: z.string(),
  scope: z.string().transform((x) => x.split(' ')),
});

export const profileResponse = z.object({
  organization: z.object({
    organization_type: z.string().transform((x) => x.replace(/^claude_/, '')),
    rate_limit_tier: z.string(),
  }),
});

export const authCredentials = z.object({
  claudeAiOauth: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresAt: z.number().int(),
    scopes: z.string().array(),
    subscriptionType: z.string(),
    rateLimitTier: z.string(),
  }),
});
