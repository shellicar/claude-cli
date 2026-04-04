/** Check if a short flag character appears in any arg (handles combined flags like -ni, -Ei). */
export function hasShortFlag(args: string[], flag: string): boolean {
  return args.some((a) => a === `-${flag}` || (a.startsWith('-') && !a.startsWith('--') && a.includes(flag)));
}
