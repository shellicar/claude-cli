import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { IWakeLockSpawner, type WakeLockProcess } from '../src/model/IWakeLockSpawner.js';
import { PlatformWakeLock } from '../src/model/PlatformWakeLock.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

class FakeSpawner extends IWakeLockSpawner {
  public readonly calls: { command: string; args: readonly string[] }[] = [];

  public spawn(command: string, args: readonly string[]): WakeLockProcess {
    this.calls.push({ command, args });
    return { kill: () => {} };
  }
}

type PreventSleepState = {
  enabled: boolean;
  platforms: { macos: string | null; windows: string | null; linux: string | null };
};

function makeConfigLoader(preventSleep: PreventSleepState): ConfigLoader<never> {
  return {
    get config() {
      return { preventSleep };
    },
  } as unknown as ConfigLoader<never>;
}

function buildWakeLock(preventSleep: PreventSleepState, fs: MemoryFileSystem, spawner: FakeSpawner): PlatformWakeLock {
  const services = createServiceCollection();
  services.register(ConfigLoader).to(ConfigLoader, () => makeConfigLoader(preventSleep));
  services.register(IWakeLockSpawner).to(IWakeLockSpawner, () => spawner);
  services.register(ILogger).to(ILogger, () => new NoopLogger());
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(PlatformWakeLock).to(PlatformWakeLock);
  return services.buildProvider().resolve(PlatformWakeLock);
}

function enabledMacos(): PreventSleepState {
  return { enabled: true, platforms: { macos: 'caffeinate', windows: null, linux: null } };
}

describe('PlatformWakeLock', () => {
  it('spawns the macOS mechanism on darwin when enabled', () => {
    const fs = new MemoryFileSystem();
    fs.setPlatform('darwin');
    const spawner = new FakeSpawner();
    const wakeLock = buildWakeLock(enabledMacos(), fs, spawner);

    wakeLock.acquire();

    const actual = spawner.calls.length;
    expect(actual).toBe(1);
  });

  it('does not spawn on an unwired platform', () => {
    const fs = new MemoryFileSystem();
    fs.setPlatform('linux');
    const spawner = new FakeSpawner();
    const wakeLock = buildWakeLock(enabledMacos(), fs, spawner);

    wakeLock.acquire();

    const actual = spawner.calls.length;
    expect(actual).toBe(0);
  });

  it('does not spawn when disabled', () => {
    const fs = new MemoryFileSystem();
    fs.setPlatform('darwin');
    const spawner = new FakeSpawner();
    const wakeLock = buildWakeLock({ enabled: false, platforms: { macos: 'caffeinate', windows: null, linux: null } }, fs, spawner);

    wakeLock.acquire();

    const actual = spawner.calls.length;
    expect(actual).toBe(0);
  });

  it('does not spawn when the platform command is null', () => {
    const fs = new MemoryFileSystem();
    fs.setPlatform('darwin');
    const spawner = new FakeSpawner();
    const wakeLock = buildWakeLock({ enabled: true, platforms: { macos: null, windows: null, linux: null } }, fs, spawner);

    wakeLock.acquire();

    const actual = spawner.calls.length;
    expect(actual).toBe(0);
  });

  it('reads the enabled flag at use-time on each acquire', () => {
    const fs = new MemoryFileSystem();
    fs.setPlatform('darwin');
    const spawner = new FakeSpawner();
    const preventSleep = enabledMacos();
    const wakeLock = buildWakeLock(preventSleep, fs, spawner);

    preventSleep.enabled = false;
    wakeLock.acquire();
    preventSleep.enabled = true;
    wakeLock.acquire();

    const actual = spawner.calls.length;
    expect(actual).toBe(1);
  });
});
