const SEPARATOR = '\n';

/** Where one argument ends and the next begins: at a newline, and nowhere else, because a path may
 *  contain a space. A carriage return before the separator came from a producer using CRLF and is
 *  not part of the argument. */
export function splitArguments(bytes: Buffer): string[] {
  return bytes
    .toString('utf8')
    .split(SEPARATOR)
    .map((argument) => (argument.endsWith('\r') ? argument.slice(0, -1) : argument))
    .filter((argument) => argument.length > 0);
}
