import { homedir } from 'node:os';
import { NormaliseOptions } from './types';

/** Expand ~ and $VAR / ${VAR} in a path string. */
export function expandPath(value: string, options?: NormaliseOptions): string;
export function expandPath(value: string | undefined, options?: NormaliseOptions): string | undefined;
export function expandPath(value: string | undefined, options?: NormaliseOptions): string | undefined {
  if (value == null) {
    return undefined;
  }
  return value
    .replace(/^~(?=\/|$)/, options?.home ?? homedir())
    .replace(/\$\{(\w+)\}|\$(\w+)/g, (_, braced: string, bare: string) => process.env[braced ?? bare] ?? '');
}
