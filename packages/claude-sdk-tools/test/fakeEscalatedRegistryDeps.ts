import { Clock } from '@js-joda/core';
import { AzSessionCache } from '../src/Az/AzSessionCache.js';

/** The escalated (gh/az) deps `createToolsV2Registry` needs, faked for tests that never actually
 *  call GitHub/AzureDevOps/Az — spread into the deps object so every registry-construction call
 *  site doesn't need its own boilerplate. */
export function fakeEscalatedRegistryDeps() {
  const executor = { run: () => Promise.reject(new Error('no real process execution in this fake')) } as never;
  return {
    ghDeps: { executor, getHolderToken: () => 'fake-gh-token' },
    adoDeps: { executor, getCert: () => 'fake-cert', getClientId: () => 'fake-client-id', getTenantId: () => 'fake-tenant-id' },
    azDeps: { executor, getCert: () => 'fake-cert', getClientId: () => 'fake-client-id', getTenantId: () => 'fake-tenant-id' },
    azSessionCache: new AzSessionCache(Clock.systemUTC()),
    getAzAccounts: () => ({}),
  };
}
