import type { IAgentContext } from './IAgentContext';
import type { IFileSystem } from './interfaces';

/** Expand ~ and $VAR / ${VAR} in a path string. */
export function expandPath(value: string, fs: IFileSystem, ctx: IAgentContext): string;
export function expandPath(value: string | undefined, fs: IFileSystem, ctx: IAgentContext): string | undefined;
export function expandPath(value: string | undefined, fs: IFileSystem, ctx: IAgentContext): string | undefined {
  if (value == null) {
    return undefined;
  }
  return value.replace(/^~(?=\/|$)/, fs.homedir()).replace(/\$\{(\w+)\}|\$(\w+)/g, (_, braced: string, bare: string) => ctx.getEnvVar(braced ?? bare) ?? '');
}

