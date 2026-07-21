import { IRulesConfigProvider, StaticRulesConfigProvider } from '../Exec/IRulesConfigProvider';
import { RulesConfigGate, type RulesConfigNotice } from '../Exec/RulesConfigGate';
import { type RuleConfig, type RuleOverrideMap, ruleConfigSchema } from '../Exec/ruleConfig';
import { type RulesSectionResult, type RulesSectionState, resolveRulesSection } from '../Exec/rulesSection';
import { type BlockedCommand, blockedCommandSchema, createExecV3 } from '../ExecV3/ExecV3';
import { ExecV3InputSchema } from '../ExecV3/schema';
import type { ExecV3Input } from '../ExecV3/types';
import { buildEnvFrom, executor, IEnvProvider } from '../exec-shared';
import { nodeFs } from '../fs/nodeFs.js';

export type { BlockedCommand, ExecV3Input, RuleConfig, RuleOverrideMap, RulesConfigNotice, RulesSectionResult, RulesSectionState };
export { blockedCommandSchema, buildEnvFrom, ExecV3InputSchema, IEnvProvider, IRulesConfigProvider, RulesConfigGate, resolveRulesSection, ruleConfigSchema, StaticRulesConfigProvider };

/** The identity env transform: no strip, no provide, just `{ ...process.env, ...cmdEnv }` — the
 *  standalone `ExecV3` export's historical behaviour, kept as the default for callers that don't
 *  care about credential scoping (e.g. tests). A real app wires its own `IEnvProvider`. */
export const passthroughEnvProvider: IEnvProvider = { buildEnv: (cmdEnv) => ({ ...process.env, ...cmdEnv }) };

export const ExecV3 = createExecV3(nodeFs, executor, passthroughEnvProvider);

/** Build the ExecV3 tool wired to nodeFs/executor with an env provider and a rules provider (see
 *  Exec/IRulesConfigProvider.ts) — injected as a live interface, not a plain snapshot, so a config
 *  reload is reflected on the next call with no rebuild. */
export const configureExecV3 = (envProvider: IEnvProvider = passthroughEnvProvider, rulesProvider: IRulesConfigProvider = new StaticRulesConfigProvider()) => createExecV3(nodeFs, executor, envProvider, rulesProvider);
