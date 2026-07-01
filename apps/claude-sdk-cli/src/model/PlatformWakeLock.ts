import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IWakeLock, type WakeLockHandle } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import type { PreventSleepConfig } from '../cli-config/types.js';
import { caffeinateWakeLock } from './caffeinateWakeLock.js';
import { IWakeLockSpawner } from './IWakeLockSpawner.js';

const NOOP_HANDLE: WakeLockHandle = { release() {} };

/**
 * The bound IWakeLock. `acquire()` is the factory: it reads preventSleep live
 * (so enable/disable and a platforms edit take effect on the next turn) and
 * branches on the platform IN CODE — never in DI. Only macOS is wired; win32/linux
 * fall through to a no-op until their mechanisms (different arguments) are added
 * as new `case`s here, not as new DI registrations. Disabled config, or a
 * platform with no configured command, is a no-op.
 */
export class PlatformWakeLock extends IWakeLock {
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(IWakeLockSpawner) private readonly spawner!: IWakeLockSpawner;
  @dependsOn(ILogger) private readonly logger!: ILogger;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;

  public acquire(): WakeLockHandle {
    const preventSleep = this.configLoader.config.preventSleep as PreventSleepConfig;
    if (!preventSleep.enabled) {
      return NOOP_HANDLE;
    }
    switch (this.fs.platform()) {
      case 'darwin': {
        const command = preventSleep.platforms.macos;
        return command == null ? NOOP_HANDLE : caffeinateWakeLock(command, this.spawner, this.logger);
      }
      // win32 / linux: their mechanisms take different arguments; each gets its
      // own case + mechanism here when wired. Not implemented now.
      default:
        return NOOP_HANDLE;
    }
  }
}
