import { dependsOn } from '@shellicar/core-di';
import { buildAuthUrl } from './buildAuthUrl';
import { localRedirectUrl } from './consts';
import { IBrowserLauncher, ICallbackListener, ICredentialStore, ILoginFlow, IProfileEndpoint, ITokenEndpoint } from './interfaces';
import { StateMismatchError } from './StateMismatchError';
import type { AuthCredentials } from './types';

export class LoginFlow extends ILoginFlow {
  @dependsOn(ICallbackListener) private readonly listener!: ICallbackListener;
  @dependsOn(IBrowserLauncher) private readonly browser!: IBrowserLauncher;
  @dependsOn(ITokenEndpoint) private readonly tokens!: ITokenEndpoint;
  @dependsOn(IProfileEndpoint) private readonly profiles!: IProfileEndpoint;
  @dependsOn(ICredentialStore) private readonly store!: ICredentialStore;

  public async run(): Promise<AuthCredentials> {
    // The listener binds before the browser opens: the redirect URL has to carry the port that was
    // actually bound.
    const listener = await this.listener.start();
    const redirectUri = localRedirectUrl(listener.port);
    const { url, codeVerifier, state } = buildAuthUrl(redirectUri);
    this.browser.open(url);

    const callback = await listener.code;
    if (callback.state !== state) {
      throw new StateMismatchError();
    }

    const exchanged = await this.tokens.exchangeCode(callback.code, state, codeVerifier, redirectUri);
    const profile = await this.profiles.fetch(exchanged.claudeAiOauth.accessToken);
    const credentials = { claudeAiOauth: { ...exchanged.claudeAiOauth, ...profile } };
    await this.store.write(credentials);
    return credentials;
  }
}
