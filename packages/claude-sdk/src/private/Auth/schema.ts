import { z } from 'zod';

export const tokenResponse = z.object({
  token_type: z.string(),
  access_token: z.string(),
  expires_in: z.number().int(),
  refresh_token: z.string(),
  scope: z.string().transform((x) => x.split(' ')),
});
