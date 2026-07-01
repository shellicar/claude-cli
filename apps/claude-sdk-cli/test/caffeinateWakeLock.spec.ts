import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { describe, expect, it } from 'vitest';
import { caffeinateWakeLock } from '../src/model/caffeinateWakeLock.js';
import { IWakeLockSpawner, type WakeLockProcess } from '../src/model/IWakeLockSpawner.js';

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

// Records spawn calls and counts kills, so the function's invocation and release
// can be verified without launching a real process.
class FakeSpawner extends IWakeLockSpawner {
  public readonly calls: { command: string; args: readonly string[] }[] = [];
  public killCount = 0;

  public spawn(command: string, args: readonly string[]): WakeLockProcess {
    this.calls.push({ command, args });
    return {
      kill: () => {
        this.killCount++;
      },
    };
  }
}

describe('caffeinateWakeLock', () => {
  it('spawns the configured command', () => {
    const spawner = new FakeSpawner();
    caffeinateWakeLock('caffeinate', spawner, new NoopLogger());

    const actual = spawner.calls[0]?.command;
    expect(actual).toBe('caffeinate');
  });

  it('passes -i to inhibit idle sleep', () => {
    const spawner = new FakeSpawner();
    caffeinateWakeLock('caffeinate', spawner, new NoopLogger());

    const actual = spawner.calls[0]?.args.includes('-i') ?? false;
    expect(actual).toBe(true);
  });

  it('kills the process on release', () => {
    const spawner = new FakeSpawner();
    const handle = caffeinateWakeLock('caffeinate', spawner, new NoopLogger());

    handle.release();

    const actual = spawner.killCount;
    expect(actual).toBe(1);
  });

  it('is idempotent on a second release', () => {
    const spawner = new FakeSpawner();
    const handle = caffeinateWakeLock('caffeinate', spawner, new NoopLogger());

    handle.release();
    handle.release();

    const actual = spawner.killCount;
    expect(actual).toBe(1);
  });
});
