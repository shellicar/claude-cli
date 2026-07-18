import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { EnvProvider, isKeychainPlatformSupported } from '../src/secrets/EnvProvider.js';
import { ISecrets } from '../src/secrets/Secrets.js';

type SecretsConfig = { stripGhCredentials: boolean; ghScoping: boolean };

class FakeSecrets extends ISecrets {
  public ghHolderToken(): string {
    return 'fake-holder-token';
  }

  public ghReaderToken(): string {
    return 'fake-reader-token';
  }
}

function makeConfigLoader(secrets: SecretsConfig): ConfigLoader<never> {
  return {
    get config() {
      return { secrets };
    },
  } as unknown as ConfigLoader<never>;
}

function buildEnvProvider(secrets: SecretsConfig): EnvProvider {
  const services = createServiceCollection();
  services.register(ISecrets).to(ISecrets, () => new FakeSecrets());
  services.register(ConfigLoader).to(ConfigLoader, () => makeConfigLoader(secrets));
  services.register(EnvProvider).to(EnvProvider);
  return services.buildProvider().resolve(EnvProvider);
}

describe('EnvProvider', () => {
  describe('stripGhCredentials', () => {
    it('removes GH_TOKEN, GITHUB_TOKEN, and SSH_AUTH_SOCK when enabled', () => {
      const envProvider = buildEnvProvider({ stripGhCredentials: true, ghScoping: false });

      const actual = envProvider.buildEnv({ GH_TOKEN: 'ambient', GITHUB_TOKEN: 'ambient', SSH_AUTH_SOCK: '/tmp/agent.sock' });

      expect(actual.GH_TOKEN).toBeUndefined();
      expect(actual.GITHUB_TOKEN).toBeUndefined();
      expect(actual.SSH_AUTH_SOCK).toBeUndefined();
    });

    it('leaves ambient gh/ssh credentials untouched when disabled', () => {
      const envProvider = buildEnvProvider({ stripGhCredentials: false, ghScoping: false });

      const actual = envProvider.buildEnv({ GH_TOKEN: 'ambient', GITHUB_TOKEN: 'ambient', SSH_AUTH_SOCK: '/tmp/agent.sock' });

      expect(actual.GH_TOKEN).toBe('ambient');
      expect(actual.GITHUB_TOKEN).toBe('ambient');
      expect(actual.SSH_AUTH_SOCK).toBe('/tmp/agent.sock');
    });

    it('is read live from config on every call, not cached at construction', () => {
      const secrets: SecretsConfig = { stripGhCredentials: true, ghScoping: false };
      const envProvider = buildEnvProvider(secrets);

      secrets.stripGhCredentials = false;
      const actual = envProvider.buildEnv({ GH_TOKEN: 'ambient' });

      expect(actual.GH_TOKEN).toBe('ambient');
    });
  });

  describe('ghScoping', () => {
    // This suite runs on ubuntu-24.04 in CI, and on whatever the developer's own machine is
    // locally, neither guaranteed to be darwin arm64, so the expected outcome is computed with
    // the same predicate the production code uses rather than hardcoded, keeping this test
    // deterministic on any machine. The predicate's own boundary (darwin + arm64, nothing else)
    // is covered exhaustively by isKeychainPlatformSupported.spec.ts; this test only verifies
    // buildEnv actually consults it.
    it('injects a reader token only when ghScoping is enabled and the platform supports it', () => {
      const envProvider = buildEnvProvider({ stripGhCredentials: true, ghScoping: true });

      const actual = envProvider.buildEnv({});

      const expected = isKeychainPlatformSupported(process.platform, process.arch) ? 'fake-reader-token' : undefined;
      expect(actual.GH_TOKEN).toBe(expected);
    });

    it('does not inject a reader token when ghScoping is disabled', () => {
      const envProvider = buildEnvProvider({ stripGhCredentials: true, ghScoping: false });

      const actual = envProvider.buildEnv({});

      expect(actual.GH_TOKEN).toBeUndefined();
    });
  });
});
