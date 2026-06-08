/**
 * Decode the four escape sequences supported by --prompt.
 *
 * Recognised: \n → LF, \r → CR, \t → tab, \\ → \
 * Anything else (e.g. \q, \u, \x) is preserved as-is. Use --file for
 * content where literal \n must round-trip.
 *
 * Single-pass regex so \\n decodes to a literal \n, not a newline.
 */
export function decodePromptEscapes(input: string): string {
  return input.replace(/\\(.)/g, (_match, ch: string) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '\\':
        return '\\';
      default:
        return `\\${ch}`;
    }
  });
}
