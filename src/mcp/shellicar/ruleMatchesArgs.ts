import type { ApproveRule } from './types';

export function ruleMatchesArgs(commandArgs: string[], rule: ApproveRule): boolean {
  return !rule.args || rule.args.every((arg) => commandArgs.includes(arg));
}
