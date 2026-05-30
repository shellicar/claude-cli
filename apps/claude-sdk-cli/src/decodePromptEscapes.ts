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
  throw new Error('not implemented');
}
