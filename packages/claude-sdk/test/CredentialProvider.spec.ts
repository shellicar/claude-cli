import { Clock, Instant, ZoneOffset } from '@js-joda/core';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { CredentialProvider } from '../src/private/Client/Auth/CredentialProvider.js';
import { ICredentialStore, ITokenEndpoint } from '../src/private/Client/Auth/interfaces.js';
import { NotAuthenticatedError } from '../src/private/Client/Auth/NotAuthenticatedError.js';
import type { AuthCredentials } from '../src/private/Client/Auth/types.js';

const NOW_MILLIS = 1_000_000;

const credentialsExpiringAt = (expiresAt: number): AuthCredentials => ({
  claudeAiOauth: {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt,
    scopes: ['user:profile'],
    subscriptionType: 'max',
    rateLimitTier: 'default',
  },
});

const refreshed = credentialsExpiringAt(NOW_MILLIS + 3_600_000);

class StubCredentialStore extends ICredentialStore {
  public readonly written: AuthCredentials[] = [];
  readonly #stored: AuthCredentials | null;

  public constructor(stored: AuthCredentials | null) {
    super();
    this.#stored = stored;
  }

  public async read(): Promise<AuthCredentials | null> {
    return this.#stored;
  }

  public async write(credentials: AuthCredentials): Promise<void> {
    this.written.push(credentials);
  }
}

class SpyTokenEndpoint extends ITokenEndpoint {
  public refreshCalls = 0;

  public async exchangeCode(): Promise<AuthCredentials> {
    throw new Error('exchangeCode is not part of the credential path');
  }

  public async refresh(): Promise<AuthCredentials> {
    this.refreshCalls++;
    return refreshed;
  }
}

function buildProvider(stored: AuthCredentials | null): { provider: CredentialProvider; store: StubCredentialStore; tokens: SpyTokenEndpoint } {
  const store = new StubCredentialStore(stored);
  const tokens = new SpyTokenEndpoint();
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(ICredentialStore)
    .using(() => store)
    .asSelf();
  services
    .register(ITokenEndpoint)
    .using(() => tokens)
    .asSelf();
  services
    .register(Clock)
    .using(() => Clock.fixed(Instant.ofEpochMilli(NOW_MILLIS), ZoneOffset.UTC))
    .asSelf();
  services.register(CredentialProvider).asSelf();
  return { provider: services.buildProvider().resolve(CredentialProvider), store, tokens };
}

describe('CredentialProvider', () => {
  it('fails with NotAuthenticatedError when nothing is stored', async () => {
    const { provider } = buildProvider(null);

    await expect(provider.get()).rejects.toThrow(NotAuthenticatedError);
  });

  it('never refreshes when nothing is stored', async () => {
    const { provider, tokens } = buildProvider(null);

    await provider.get().catch(() => {});

    const expected = 0;
    const actual = tokens.refreshCalls;
    expect(actual).toBe(expected);
  });

  it('returns the stored credentials while they are still valid', async () => {
    const stored = credentialsExpiringAt(NOW_MILLIS + 1);
    const { provider } = buildProvider(stored);

    const expected = stored;
    const actual = await provider.get();
    expect(actual).toBe(expected);
  });

  it('refreshes credentials that have expired', async () => {
    const { provider } = buildProvider(credentialsExpiringAt(NOW_MILLIS));

    const expected = refreshed;
    const actual = await provider.get();
    expect(actual).toBe(expected);
  });

  it('stores the refreshed credentials', async () => {
    const { provider, store } = buildProvider(credentialsExpiringAt(NOW_MILLIS));

    await provider.get();

    const expected = [refreshed];
    const actual = store.written;
    expect(actual).toEqual(expected);
  });
});
