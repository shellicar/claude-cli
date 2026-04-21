import type { IFileSystem } from './interfaces';

/** Expand ~ and $VAR / ${VAR} in a path string. */
export function expandPath(value: string, fs: IFileSystem): string;
export function expandPath(value: string | undefined, fs: IFileSystem): string | undefined;
export function expandPath(value: string | undefined, fs: IFileSystem): string | undefined {
  if (value == null) {
    return undefined;
  }
  return value.replace(/^~(?=\/|$)/, fs.homedir()).replace(/\$\{(\w+)\}|\$(\w+)/g, (_, braced: string, bare: string) => fs.getEnvVar(braced ?? bare) ?? '');
}
