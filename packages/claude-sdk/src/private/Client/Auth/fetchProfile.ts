import { ProfileUrl } from './consts';
import { profileResponse } from './schema';

export type ProfileData = {
  subscriptionType: string;
  rateLimitTier: string;
};

export const fetchProfile = async (accessToken: string): Promise<ProfileData> => {
  const response = await fetch(ProfileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = profileResponse.parse(await response.json());
  return {
    subscriptionType: data.organization.organization_type,
    rateLimitTier: data.organization.rate_limit_tier,
  } satisfies ProfileData;
};
