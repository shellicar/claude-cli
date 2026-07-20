import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the platform-appropriate persistent-data directory for `appName`.
 * Honours $XDG_DATA_HOME on Linux if set (still the escape hatch everywhere,
 * since anyone can export it), falls back to each OS's real convention.
 *
 * Inlined from @shellicar/mcp-internals (private, never published, designed
 * to be copied into any MCP server that needs it — see that package's README).
 */
export function getDataDir(appName: string) {
  const home = homedir();

  if (process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, appName);
  }

  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', appName);
    case 'win32':
      return join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), appName);
    default: // linux and friends
      return join(home, '.local', 'share', appName);
  }
}
