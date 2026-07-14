import EventEmitter from 'node:events';
import path from 'node:path';
import { expandPath } from '@shellicar/claude-core/fs/expandPath';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di-lite';

type WorkingDirectoryEvents = {
  /** Fires only after the move succeeds, carrying the new working directory. */
  change: [cwd: string];
};

/** The outcome of an attempted move: success, or a failure carrying a display message. */
export type ChangeDirectoryResult = { ok: true } | { ok: false; message: string };

/**
 * The authority for moving a running session to a new working directory.
 *
 * `change` resolves the target against the current cwd (so `../` and relative
 * segments behave as typed), then performs the one authoritative check — the
 * `chdir` itself. Everything before it is advisory: a path can look valid and
 * be gone the instant the move is attempted. On success it emits `change` with
 * the new cwd; on failure it reports the reason and the cwd is untouched.
 *
 * The follow-on reloads (config, SYSTEM.md, CLAUDE.md, the status basename)
 * hang off the `change` event, wired in `main`: the move is the trigger, the
 * subscribers re-point and reload.
 */
export class WorkingDirectory {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  readonly #emitter = new EventEmitter<WorkingDirectoryEvents>();

  public on<K extends keyof WorkingDirectoryEvents>(event: K, listener: (...args: WorkingDirectoryEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof WorkingDirectoryEvents>(event: K, listener: (...args: WorkingDirectoryEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  /**
   * Attempt to move to `target`. A blank target is rejected rather than
   * silently resolving to the current directory (which would chdir to where we
   * already are and read as a successful no-op). Otherwise resolves `~`/`$VAR`
   * and any relative or `..` segments against the current cwd, then chdirs.
   * Returns success or a failure message; emits `change` only on success.
   */
  public change(target: string): ChangeDirectoryResult {
    const trimmed = target.trim();
    if (trimmed === '') {
      return { ok: false, message: 'no directory entered' };
    }
    const resolved = path.resolve(this.fs.cwd(), expandPath(trimmed, this.fs));
    try {
      this.fs.chdir(resolved);
    } catch (err) {
      return { ok: false, message: describeChdirError(err) };
    }
    this.#emitter.emit('change', this.fs.cwd());
    return { ok: true };
  }
}

function describeChdirError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') {
    return 'no such directory';
  }
  if (code === 'ENOTDIR') {
    return 'not a directory';
  }
  return err instanceof Error ? err.message : String(err);
}
