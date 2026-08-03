import type { ToolMatch } from './types.js';

/** Concern 1, isolated: does this rule's `tool` field cover the named tool? Absent or `'*'`
 *  covers everything \u2014 the engine never needs to know what tools exist to answer this. */
export function matchesTool(match: ToolMatch | undefined, toolName: string): boolean {
  if (match == null || match === '*') {
    return true;
  }
  if (Array.isArray(match)) {
    return match.includes(toolName);
  }
  return match === toolName;
}
