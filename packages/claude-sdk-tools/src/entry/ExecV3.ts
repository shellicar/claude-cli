import { ruleConfigSchema, type RuleConfig, type RuleOverrideMap } from '../Exec/ruleConfig';
import { blockedCommandSchema, type BlockedCommand, createExecV3 } from '../ExecV3/ExecV3';
import { ExecV3InputSchema } from '../ExecV3/schema';
import type { ExecV3Input } from '../ExecV3/types';
import { buildEnvFrom, executor, IEnvProvider } from '../exec-shared';
import { nodeFs } from '../fs/nodeFs.js';

export type { BlockedCommand, ExecV3Input, RuleConfig, RuleOverrideMap };
export { blockedCommandSchema, buildEnvFrom, ExecV3InputSchema, IEnvProvider, ruleConfigSchema };

/** The identity env transform: no strip, no provide, just `{ ...process.env, ...cmdEnv }` — the
 *  standalone `ExecV3` export's historical behaviour, kept as the default for callers that don't
 *  care about credential scoping (e.g. tests). A real app wires its own `IEnvProvider`. */
export const passthroughEnvProvider: IEnvProvider = { buildEnv: (cmdEnv) => ({ ...process.env, ...cmdEnv }) };

export const ExecV3 = createExecV3(nodeFs, executor, passthroughEnvProvider);

/** Build the ExecV3 tool wired to nodeFs/executor with an env provider, an extra config-driven blocklist, and safety-rule overrides (see Exec/ruleConfig.ts). */
export const configureExecV3 = (envProvider: IEnvProvider = passthroughEnvProvider, blockedCommands: BlockedCommand[] = [], ruleOverrides: RuleOverrideMap = {}) =>
  createExecV3(nodeFs, executor, envProvider, blockedCommands, undefined, ruleOverrides);
