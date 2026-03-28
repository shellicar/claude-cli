// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escape sequences requires \x1b
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Strips ANSI SGR escape codes and returns the visible character length.
 * Handles colour, bold, inverse, and reset sequences only.
 * Does not account for multi-width characters (emoji, CJK).
 */
export function stripAnsiLength(str: string): number {
  return str.replace(ANSI_PATTERN, '').length;
}
