import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { type CallbackListener, IBrowserLauncher, ICallbackListener, ICredentialStore, IProfileEndpoint, ITokenEndpoint } from '../src/private/Client/Auth/interfaces.js';
import { LoginFlow } from '../src/private/Client/Auth/LoginFlow.js';
import type { AuthCredentials, ProfileData } from '../src/private/Client/Auth/types.js';

const exchanged: AuthCredentials = {
  claudeAiOauth: {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: 4_000_000_000_000,
    scopes: ['user:profile'],
    subscriptionType: '',
    rateLimitTier: '',
  },
};

class StubCallbackListener extends ICallbackListener {
  readonly #state: string;

  public constructor(state: string) {
    super();
    this.#state = state;
  }

  public async start(): Promise<CallbackListener> {
    return { port: 54321, code: Promise.resolve({ code: 'callback-code', state: this.#state }) };
  }
}

class StubBrowserLauncher extends IBrowserLauncher {
  public open(): void {}
}

class StubTokenEndpoint extends ITokenEndpoint {
  public async exchangeCode(): Promise<AuthCredentials> {
    return exchanged;
  }

  public async refresh(): Promise<AuthCredentials> {
    return exchanged;
  }
}

class StubProfileEndpoint extends IProfileEndpoint {
  public async fetch(): Promise<ProfileData> {
    return { subscriptionType: 'max', rateLimitTier: 'default' };
  }
}

class SpyCredentialStore extends ICredentialStore {
  public readonly written: AuthCredentials[] = [];

  public async read(): Promise<AuthCredentials | null> {
    return null;
  }

  public async write(credentials: AuthCredentials): Promise<void> {
    this.written.push(credentials);
  }
}

/** A login whose callback comes back carrying `callbackState` — what a hijacked redirect controls. */
function buildLoginFlow(callbackState: string): { flow: LoginFlow; store: SpyCredentialStore } {
  const store = new SpyCredentialStore();
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(ICallbackListener)
    .using(() => new StubCallbackListener(callbackState))
    .asSelf();
  services.register(StubBrowserLauncher).as(IBrowserLauncher);
  services.register(StubTokenEndpoint).as(ITokenEndpoint);
  services.register(StubProfileEndpoint).as(IProfileEndpoint);
  services
    .register(ICredentialStore)
    .using(() => store)
    .asSelf();
  services.register(LoginFlow).asSelf();
  return { flow: services.buildProvider().resolve(LoginFlow), store };
}

describe('LoginFlow', () => {
  it('rejects a callback whose state does not match the one the request was built with', async () => {
    const { flow } = buildLoginFlow('not-the-generated-state');

    await expect(flow.run()).rejects.toThrow();
  });

  it('stores no credentials when the callback state does not match', async () => {
    const { flow, store } = buildLoginFlow('not-the-generated-state');

    await flow.run().catch(() => {});

    const expected = 0;
    const actual = store.written.length;
    expect(actual).toBe(expected);
  });
});
