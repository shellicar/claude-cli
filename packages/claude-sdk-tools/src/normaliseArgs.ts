/** `--foo=bar` -> `--foo` (the value is never matched on). A single-dash multi-character token is
 *  ambiguous on shape alone \u2014 `-ni` is bundled short flags (POSIX getopt: `-n -i`), but `-exec` is
 *  one word-flag (find's convention) \u2014 so both readings are kept rather than choosing: the token
 *  normalises to itself *plus* its exploded per-character short flags. `argsAnyOf: ['-exec']` still
 *  matches the literal token; `argsAnyOf: ['-i']` still matches `-ni` via the exploded form.
 *
 *  A neutral, domain-general utility (CLI argument conventions, not any specific tool's schema) \u2014
 *  shared by `Exec/ruleConfig.ts` and `Policy/matchValue.ts` rather than either depending on the
 *  other. */
export function normaliseArg(arg: string): string[] {
  if (arg.startsWith('--')) {
    const eq = arg.indexOf('=');
    return [eq === -1 ? arg : arg.slice(0, eq)];
  }
  if (arg.startsWith('-') && arg.length > 2) {
    return [
      arg,
      ...arg
        .slice(1)
        .split('')
        .map((c) => `-${c}`),
    ];
  }
  return [arg];
}

export function normaliseArgs(args: string[]): string[] {
  return args.flatMap(normaliseArg);
}
