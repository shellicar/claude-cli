import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { describe, expect, it } from 'vitest';
import { ConfigDisabledToolsProvider } from '../src/setup/ConfigDisabledToolsProvider.js';

type AzAccounts = Record<string, { tenantId: string; reader: unknown; holder: unknown }>;

function makeLoader(disabledTools: string[], azAccounts: AzAccounts = {}): ConfigLoader<any> {
  return new ConfigLoader({ config: { disabledTools, az: { accounts: azAccounts } }, sources: [], warnings: [] });
}

describe('ConfigDisabledToolsProvider', () => {
  it('reflects the config loader disabledTools as a set', () => {
    const provider = new ConfigDisabledToolsProvider();
    provider.configLoader = makeLoader(['ExecV3']);
    const actual = provider.disabledTools;
    expect(actual.has('ExecV3')).toBe(true);
  });

  it('reads the config loader live, reflecting an applied config change', () => {
    const loader = makeLoader([]);
    const provider = new ConfigDisabledToolsProvider();
    provider.configLoader = loader;
    loader.apply({ config: { disabledTools: ['DeleteFile'], az: { accounts: {} } }, sources: [], warnings: [] });
    const actual = provider.disabledTools;
    expect(actual.has('DeleteFile')).toBe(true);
  });

  describe('az/AzureDevOps tool availability', () => {
    it('disables AzCli when no account has a reader identity configured', () => {
      const provider = new ConfigDisabledToolsProvider();
      provider.configLoader = makeLoader([]);
      const actual = provider.disabledTools.has('AzCli');
      expect(actual).toBe(true);
    });

    it('does not disable AzCli when an account has a reader identity configured', () => {
      const provider = new ConfigDisabledToolsProvider();
      provider.configLoader = makeLoader([], { shellicar: { tenantId: 't', reader: { type: 'cert', clientId: 'r', subscriptionIds: [] }, holder: null } });
      const actual = provider.disabledTools.has('AzCli');
      expect(actual).toBe(false);
    });

    it('disables EscalatedAzCli and every AzureDevOps.PullRequest.* tool when no account has a holder identity configured', () => {
      const provider = new ConfigDisabledToolsProvider();
      provider.configLoader = makeLoader([]);
      const disabled = provider.disabledTools;
      const expected = true;
      const actual = disabled.has('EscalatedAzCli') && disabled.has('AzureDevOps_PullRequest_Create');
      expect(actual).toBe(expected);
    });

    it('does not disable EscalatedAzCli or AzureDevOps.PullRequest.* tools when an account has a holder identity configured', () => {
      const provider = new ConfigDisabledToolsProvider();
      provider.configLoader = makeLoader([], { shellicar: { tenantId: 't', reader: null, holder: { type: 'cert', clientId: 'h', subscriptionIds: [] } } });
      const disabled = provider.disabledTools;
      const expected = false;
      const actual = disabled.has('EscalatedAzCli') || disabled.has('AzureDevOps_PullRequest_Create');
      expect(actual).toBe(expected);
    });

    it('reflects a config reload adding a holder account, with no rebuild', () => {
      const loader = makeLoader([]);
      const provider = new ConfigDisabledToolsProvider();
      provider.configLoader = loader;
      loader.apply({ config: { disabledTools: [], az: { accounts: { shellicar: { tenantId: 't', reader: null, holder: { type: 'cert', clientId: 'h', subscriptionIds: [] } } } } }, sources: [], warnings: [] });
      const actual = provider.disabledTools.has('EscalatedAzCli');
      expect(actual).toBe(false);
    });
  });
});
