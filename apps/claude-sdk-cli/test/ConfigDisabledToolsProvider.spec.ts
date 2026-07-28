import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import type { AnyToolDefinition } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import { StatusState } from '../src/model/StatusState.js';
import { ToolModeSettings } from '../src/model/ToolModeState.js';
import { ConfigDisabledToolsProvider } from '../src/setup/ConfigDisabledToolsProvider.js';

type AzAccounts = Record<string, { tenantId: string; reader: unknown; holder: unknown }>;

function makeLoader(disabledTools: string[], azAccounts: AzAccounts = {}): ConfigLoader<any> {
  return new ConfigLoader({ config: { disabledTools, az: { accounts: azAccounts } }, sources: [], warnings: [] });
}

/** The provider's toolModeState/appTools deps are set directly here (as configLoader already is
 *  above) rather than through DI — a fresh ToolModeSettings stays in its default 'normal' mode
 *  unless a test calls .cycle(), so it never disables anything on its own. */
function makeProvider(loader: ConfigLoader<any>, tools: AnyToolDefinition[] = []): ConfigDisabledToolsProvider {
  const provider = new ConfigDisabledToolsProvider();
  provider.configLoader = loader;
  const toolModeState = new ToolModeSettings();
  (toolModeState as unknown as { statusState: StatusState }).statusState = new StatusState('cwd');
  provider.toolModeState = toolModeState;
  provider.appTools = { tools } as unknown as ConfigDisabledToolsProvider['appTools'];
  return provider;
}

describe('ConfigDisabledToolsProvider', () => {
  it('reflects the config loader disabledTools as a set', () => {
    const provider = makeProvider(makeLoader(['ExecV3']));
    const actual = provider.disabledTools;
    expect(actual.has('ExecV3')).toBe(true);
  });

  it('reads the config loader live, reflecting an applied config change', () => {
    const loader = makeLoader([]);
    const provider = makeProvider(loader);
    loader.apply({ config: { disabledTools: ['DeleteFile'], az: { accounts: {} } }, sources: [], warnings: [] });
    const actual = provider.disabledTools;
    expect(actual.has('DeleteFile')).toBe(true);
  });

  describe('az/AzureDevOps tool availability', () => {
    it('disables AzCli when no account has a reader identity configured', () => {
      const provider = makeProvider(makeLoader([]));
      const actual = provider.disabledTools.has('AzCli');
      expect(actual).toBe(true);
    });

    it('does not disable AzCli when an account has a reader identity configured', () => {
      const provider = makeProvider(makeLoader([], { shellicar: { tenantId: 't', reader: { type: 'cert', clientId: 'r', subscriptionIds: [] }, holder: null } }));
      const actual = provider.disabledTools.has('AzCli');
      expect(actual).toBe(false);
    });

    it('disables EscalatedAzCli and every AzureDevOps.PullRequest.* tool when no account has a holder identity configured', () => {
      const provider = makeProvider(makeLoader([]));
      const disabled = provider.disabledTools;
      const expected = true;
      const actual = disabled.has('EscalatedAzCli') && disabled.has('AzureDevOps_PullRequest_Create');
      expect(actual).toBe(expected);
    });

    it('does not disable EscalatedAzCli or AzureDevOps.PullRequest.* tools when an account has a holder identity configured', () => {
      const provider = makeProvider(makeLoader([], { shellicar: { tenantId: 't', reader: null, holder: { type: 'cert', clientId: 'h', subscriptionIds: [] } } }));
      const disabled = provider.disabledTools;
      const expected = false;
      const actual = disabled.has('EscalatedAzCli') || disabled.has('AzureDevOps_PullRequest_Create');
      expect(actual).toBe(expected);
    });

    it('reflects a config reload adding a holder account, with no rebuild', () => {
      const loader = makeLoader([]);
      const provider = makeProvider(loader);
      loader.apply({ config: { disabledTools: [], az: { accounts: { shellicar: { tenantId: 't', reader: null, holder: { type: 'cert', clientId: 'h', subscriptionIds: [] } } } } }, sources: [], warnings: [] });
      const actual = provider.disabledTools.has('EscalatedAzCli');
      expect(actual).toBe(false);
    });
  });

  describe('tool-mode gating', () => {
    const readTool = { name: 'ReadFile', operation: 'read' } as AnyToolDefinition;
    const ephemeralReadTool = { name: 'Ref', operation: 'ephemeral.read' } as AnyToolDefinition;
    const writeTool = { name: 'EditFile', operation: 'write' } as AnyToolDefinition;
    const escalateTool = { name: 'EscalatedAzCli', operation: 'escalate' } as AnyToolDefinition;

    it('disables nothing extra in normal mode', () => {
      const provider = makeProvider(makeLoader([]), [readTool, writeTool]);
      const actual = provider.disabledTools.has('EditFile');
      expect(actual).toBe(false);
    });

    it('keeps read tools enabled in read-only mode', () => {
      const provider = makeProvider(makeLoader([]), [readTool, ephemeralReadTool, writeTool]);
      provider.toolModeState.cycle();
      const actual = provider.disabledTools.has('ReadFile') || provider.disabledTools.has('Ref');
      expect(actual).toBe(false);
    });

    it('disables write and escalate tools in read-only mode', () => {
      const provider = makeProvider(makeLoader([]), [readTool, writeTool, escalateTool]);
      provider.toolModeState.cycle();
      const disabled = provider.disabledTools;
      const expected = true;
      const actual = disabled.has('EditFile') && disabled.has('EscalatedAzCli');
      expect(actual).toBe(expected);
    });

    it('disables every tool, including read ones, in no-tools mode', () => {
      const provider = makeProvider(makeLoader([]), [readTool, ephemeralReadTool, writeTool]);
      provider.toolModeState.cycle();
      provider.toolModeState.cycle();
      const disabled = provider.disabledTools;
      const expected = true;
      const actual = disabled.has('ReadFile') && disabled.has('Ref') && disabled.has('EditFile');
      expect(actual).toBe(expected);
    });
  });
});
