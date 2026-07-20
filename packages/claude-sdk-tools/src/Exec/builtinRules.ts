import { buildExecRules, defaultRules } from './ruleConfig';
import type { ExecRule } from './types';

/** The built-in safety rules, compiled from `defaultRules` (see ruleConfig.ts). Exec/ExecV2 use this
 *  fixed list; ExecV3 merges config overrides in before compiling (see ExecV3.ts). */
export const builtinRules: ExecRule[] = buildExecRules(defaultRules);
