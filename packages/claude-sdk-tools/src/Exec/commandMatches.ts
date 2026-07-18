/**
 * A command matches a pattern when the program is identical and every arg in the
 * pattern appears, in order, somewhere in the command's args (an ordered
 * subsequence). Interspersed flags do not defeat the match, so `gh pr create`,
 * `gh pr create --title x`, and `gh --repo r pr create` all match { program: 'gh',
 * args: ['pr', 'create'] }. An empty pattern arg list matches on program alone.
 */
export function commandMatches(cmd: { program: string; args: string[] }, pattern: { program: string; args: string[] }): boolean {
  if (cmd.program !== pattern.program) {
    return false;
  }
  let i = 0;
  for (const arg of cmd.args) {
    if (i < pattern.args.length && arg === pattern.args[i]) {
      i++;
    }
  }
  return i === pattern.args.length;
}
