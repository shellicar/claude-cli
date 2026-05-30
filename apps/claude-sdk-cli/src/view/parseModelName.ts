export type ParsedModelName = {
  readonly name: string;
  readonly version: string | null;
};

/**
 * Split a configured model string into a display name and version.
 *
 *   claude-sonnet-4-6   → { name: 'Sonnet',  version: '4.6' }
 *   claude-opus         → { name: 'Opus',    version: null   }
 *   claude-mrmagoo-4    → { name: 'Mrmagoo', version: '4'    }
 *   claude-mrmagoo      → { name: 'Mrmagoo', version: null   }
 *
 * Rules:
 *   - Family is the first non-numeric token after the leading "claude".
 *   - Version is the trailing numeric tokens, joined by ".".
 *   - No trailing numerics → version is null.
 *
 * Old-style names (e.g. claude-3-5-sonnet-20241022) are out of scope.
 * The function returns *something* for them but the result is not promised.
 */
export function parseModelName(model: string): ParsedModelName {
  throw new Error('not implemented');
}
