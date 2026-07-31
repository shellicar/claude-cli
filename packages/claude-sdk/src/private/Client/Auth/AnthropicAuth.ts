import { execFile } from 'node:child_process';
import { buildAuthUrl } from './buildAuthUrl';
import { localRedirectUrl, PlatformRedirectUrl } from './consts';
import { exchangeCode } from './exchangeCode';
import { fetchProfile } from './fetchProfile';
import { isExpired } from './isExpired';
import { loadCredentials } from './loadCredentials';
import { NotAuthenticatedError } from './NotAuthenticatedError';
import { refreshCredentials } from './refreshCredentials';
import { saveCredentials } from './saveCredentials';
import { startCallbackListener } from './startCallbackListener';
import type { AnthropicAuthOptions, AuthCredentials, GetCredentialsOptions } from './types';

export class AnthropicAuth {
  private readonly redirect: 'local' | 'manual';

  public constructor(options: AnthropicAuthOptions = {}) {
    this.redirect = options.redirect ?? 'local';
  }

  public async getCredentials(options: GetCredentialsOptions = {}): Promise<AuthCredentials> {
    const interactiveLogin = options.interactiveLogin ?? true;
    let credentials = await loadCredentials();

    if (credentials === null) {
      if (!interactiveLogin) {
        throw new NotAuthenticatedError();
      }
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
      // The listener binds before the browser opens: the redirect URL has to carry the port the OS
      // actually assigned.
      const listener = await startCallbackListener();
      const redirectUri = localRedirectUrl(listener.port);
      const { url, codeVerifier, state } = buildAuthUrl(redirectUri);
      execFile('open', [url]);
      const { code } = await listener.code;
      return exchangeCode(code, state, codeVerifier, redirectUri);
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
