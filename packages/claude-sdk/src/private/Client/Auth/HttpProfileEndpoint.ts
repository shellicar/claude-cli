import { ProfileUrl } from './consts';
import { IProfileEndpoint } from './interfaces';
import { profileResponse } from './schema';
import type { ProfileData } from './types';

export class HttpProfileEndpoint extends IProfileEndpoint {
  public async fetch(accessToken: string): Promise<ProfileData> {
    const response = await globalThis.fetch(ProfileUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = profileResponse.parse(await response.json());
    return {
      subscriptionType: data.organization.organization_type,
      rateLimitTier: data.organization.rate_limit_tier,
    } satisfies ProfileData;
  }
}
