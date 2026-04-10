import { execFile } from 'node:child_process';
import { buildAuthUrl } from './buildAuthUrl';
import { LocalRedirectUrl, PlatformRedirectUrl } from './consts';
import { exchangeCode } from './exchangeCode';
import { fetchProfile } from './fetchProfile';
import { isExpired } from './isExpired';
import { loadCredentials } from './loadCredentials';
import { refreshCredentials } from './refreshCredentials';
import { saveCredentials } from './saveCredentials';
import type { AnthropicAuthOptions, AuthCredentials } from './types';
import { waitForCallback } from './waitForCallback';

export class AnthropicAuth {
  private readonly redirect: 'local' | 'manual';

  public constructor(options: AnthropicAuthOptions = {}) {
    this.redirect = options.redirect ?? 'local';
  }

  public async getCredentials(): Promise<AuthCredentials> {
    let credentials = await loadCredentials();

    if (credentials === null) {
      credentials = await this.login();
      const profile = await fetchProfile(credentials.claudeAiOauth.accessToken);
      credentials = { claudeAiOauth: { ...credentials.claudeAiOauth, ...profile } };
      await saveCredentials(credentials);
    } else if (isExpired(credentials)) {
      credentials = await refreshCredentials(credentials);
      await saveCredentials(credentials);
    }

    return credentials;
  }

  private async login(): Promise<AuthCredentials> {
    if (this.redirect === 'local') {
      const { url, codeVerifier, state } = buildAuthUrl(LocalRedirectUrl);
      execFile('open', [url]);
      const { code } = await waitForCallback(3001);
      return exchangeCode(code, state, codeVerifier, LocalRedirectUrl);
    }

    const { url, codeVerifier, state } = buildAuthUrl(PlatformRedirectUrl);
    // biome-ignore lint/suspicious/noConsole: show url
    console.log(url);
    process.stdout.write('Paste code: ');
    const input = await new Promise<string>((resolve) => {
      process.stdin.once('data', (data) => resolve(data.toString().trim()));
    });
    const code = input.split('#')[0];
    return exchangeCode(code, state, codeVerifier, PlatformRedirectUrl);
  }
}
