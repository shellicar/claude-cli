/** What sits between one stage and the next. It holds bytes, and its size is how far a writer may
 *  be ahead of its reader. Nothing about what passes through it is interpreted, and how much passes
 *  through in total is not bounded. */
export type Channel = {
  /** Resolves when the bytes are taken, or `false` when the reader has gone. */
  write: (bytes: Buffer) => Promise<boolean>;
  /** The next bytes, at most `max` of them, or `undefined` once the writer has finished. */
  read: (max?: number) => Promise<Buffer | undefined>;
  /** The writer has nothing more to send. */
  end: () => void;
  /** The reader has gone. */
  close: () => void;
  /** The writer broke; the reader is told rather than seeing a clean end. */
  fail: (err: unknown) => void;
};

export function channel(size: number): Channel {
  const queued: Buffer[] = [];
  let held = 0;
  let ended = false;
  let closed = false;
  let failure: unknown;
  let wakeReader: (() => void) | undefined;
  let wakeWriter: (() => void) | undefined;

  const wake = (waiter: (() => void) | undefined): undefined => {
    waiter?.();
    return undefined;
  };

  return {
    write: async (bytes) => {
      while (held >= size && !closed) {
        await new Promise<void>((resolve) => {
          wakeWriter = resolve;
        });
      }
      if (closed) {
        return false;
      }
      queued.push(bytes);
      held += bytes.length;
      wakeReader = wake(wakeReader);
      return true;
    },

    read: async (max) => {
      while (queued.length === 0 && !ended && failure === undefined && !closed) {
        await new Promise<void>((resolve) => {
          wakeReader = resolve;
        });
      }
      const next = queued.shift();
      if (next === undefined) {
        if (failure !== undefined) {
          throw failure;
        }
        return undefined;
      }
      const taken = max != null && max < next.length ? next.subarray(0, max) : next;
      if (taken !== next) {
        queued.unshift(next.subarray(taken.length));
      }
      held -= taken.length;
      wakeWriter = wake(wakeWriter);
      return taken;
    },

    end: () => {
      ended = true;
      wakeReader = wake(wakeReader);
    },

    close: () => {
      closed = true;
      wakeWriter = wake(wakeWriter);
      wakeReader = wake(wakeReader);
    },

    fail: (err) => {
      failure = err;
      wakeReader = wake(wakeReader);
    },
  };
}
