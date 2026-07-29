import type { IEnvProvider } from '../src/exec-shared.js';

/** An env provider that strips nothing and injects nothing — the ambient environment plus whatever
 *  the call itself supplied. Tests that care about variable expansion pass their own `vars`; tests
 *  that don't get the plain pass-through. */
export function fakeEnvProvider(vars: NodeJS.ProcessEnv = {}): IEnvProvider {
  return { buildEnv: (cmdEnv) => ({ ...process.env, ...vars, ...cmdEnv }) };
}
