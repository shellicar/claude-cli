import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { WakeLockHandle } from '@shellicar/claude-sdk';
import type { IWakeLockSpawner } from './IWakeLockSpawner.js';

/**
 * macOS wake-lock mechanism. Owns caffeinate's specific invocation; nothing here
 * is shared with other platforms, whose mechanisms take entirely different
 * arguments. -i inhibits idle sleep only (not lid-close — accepted); -w <pid>
 * makes caffeinate exit if the CLI dies without releasing, so a crash can't leak
 * a process holding the machine awake. release() is the normal lifecycle.
 */
export function caffeinateWakeLock(command: string, spawner: IWakeLockSpawner, log: ILogger): WakeLockHandle {
  const proc = spawner.spawn(command, ['-i', '-w', String(process.pid)]);
  log.debug('wake lock acquired', { command });
  let released = false;
  return {
    release: () => {
      if (released) {
        return;
      }
      released = true;
      proc.kill();
      log.debug('wake lock released', { command });
    },
  };
}
