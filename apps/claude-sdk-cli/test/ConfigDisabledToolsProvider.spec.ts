import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { describe, expect, it } from 'vitest';
import { ConfigDisabledToolsProvider } from '../src/setup/ConfigDisabledToolsProvider.js';

function makeLoader(disabledTools: string[]): ConfigLoader<any> {
  return new ConfigLoader({ config: { disabledTools }, sources: [], warnings: [] });
}

describe('ConfigDisabledToolsProvider', () => {
  it('reflects the config loader disabledTools as a set', () => {
    const provider = new ConfigDisabledToolsProvider();
    provider.configLoader = makeLoader(['ExecV3']);
    const actual = provider.disabledTools;
    const expected = new Set(['ExecV3']);
    expect(actual).toEqual(expected);
  });

  it('reads the config loader live, reflecting an applied config change', () => {
    const loader = makeLoader([]);
    const provider = new ConfigDisabledToolsProvider();
    provider.configLoader = loader;
    loader.apply({ config: { disabledTools: ['DeleteFile'] }, sources: [], warnings: [] });
    const actual = provider.disabledTools;
    const expected = new Set(['DeleteFile']);
    expect(actual).toEqual(expected);
  });
});
