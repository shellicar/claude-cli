import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { EnvProvider } from '../src/secrets/EnvProvider.js';
import { ISecrets } from '../src/secrets/Secrets.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

type SecretsConfig = { stripGhCredentials: boolean; ghScoping: boolean };

class FakeSecrets extends ISecrets {
  public ghHolderToken(): string {
    return 'fake-holder-token';
  }

  public ghReaderToken(): string {
    return 'fake-reader-token';
  }

  public azCert(): string {
    return 'fake-az-cert';
  }
}

function makeConfigLoader(secrets: SecretsConfig): ConfigLoader<never> {
  return {
    get config() {
      return { secrets };
    },
  } as unknown as ConfigLoader<never>;
}

function buildEnvProvider(secrets: SecretsConfig, fs: IFileSystem = new MemoryFileSystem()): EnvProvider {
  const services = createServiceCollection();
  services.register(ISecrets).to(ISecrets, () => new FakeSecrets());
  services.register(ConfigLoader).to(ConfigLoader, () => makeConfigLoader(secrets));
  services.register(IFileSystem).to(IFileSystem, () => fs);
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
    // Platform/arch are read through the injected IFileSystem (not the real host), so these
    // are deterministic on any machine, unlike relying on the real process.platform/arch. The
    // predicate's own boundary (darwin + arm64, nothing else) is covered exhaustively by
    // isKeychainPlatformSupported.spec.ts; this suite only verifies buildEnv consults it via fs.
    it('injects a reader token when ghScoping is enabled on a supported platform', () => {
      const fs = new MemoryFileSystem();
      fs.setPlatform('darwin');
      fs.setArch('arm64');
      const envProvider = buildEnvProvider({ stripGhCredentials: true, ghScoping: true }, fs);

      const actual = envProvider.buildEnv({});

      expect(actual.GH_TOKEN).toBe('fake-reader-token');
    });

    it('does not inject a reader token on an unsupported platform even when ghScoping is enabled', () => {
      const fs = new MemoryFileSystem();
      fs.setPlatform('linux');
      fs.setArch('arm64');
      const envProvider = buildEnvProvider({ stripGhCredentials: true, ghScoping: true }, fs);

      const actual = envProvider.buildEnv({});

      expect(actual.GH_TOKEN).toBeUndefined();
    });

    it('does not inject a reader token on an unsupported arch even when ghScoping is enabled', () => {
      const fs = new MemoryFileSystem();
      fs.setPlatform('darwin');
      fs.setArch('x64');
      const envProvider = buildEnvProvider({ stripGhCredentials: true, ghScoping: true }, fs);

      const actual = envProvider.buildEnv({});

      expect(actual.GH_TOKEN).toBeUndefined();
    });

    it('does not inject a reader token when ghScoping is disabled', () => {
      const fs = new MemoryFileSystem();
      fs.setPlatform('darwin');
      fs.setArch('arm64');
      const envProvider = buildEnvProvider({ stripGhCredentials: true, ghScoping: false }, fs);

      const actual = envProvider.buildEnv({});

      expect(actual.GH_TOKEN).toBeUndefined();
    });
  });
});
