/**
 * Strip ANSI escape sequences from a string.
 * Handles: SGR (colors/styles), cursor movement, erase, OSC, and other CSI sequences.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI regex intentionally matches escape sequences
const ANSI_PATTERN = /[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}
