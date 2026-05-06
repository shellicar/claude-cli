import { describe, expect, it } from 'vitest';
import { ControlChannel } from '../src/private/ControlChannel.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// send is fire-and-forget
// ---------------------------------------------------------------------------

describe('ControlChannel — send is fire-and-forget', () => {
  it('three sequential send calls return before the first handler resolves', () => {
    const channel = new ControlChannel<string>();
    const d = deferred();
    const returned: number[] = [];

    channel.subscribe(async () => {
      await d.promise;
    });

    channel.send('a');
    returned.push(1);
    channel.send('b');
    returned.push(2);
    channel.send('c');
    returned.push(3);

    const expected = [1, 2, 3];
    const actual = returned;
    expect(actual).toEqual(expected);

    d.resolve();
  });
});

// ---------------------------------------------------------------------------
// Handler serialisation
// ---------------------------------------------------------------------------

describe('ControlChannel — handler serialisation', () => {
  it('second message is not delivered until the first handler resolves', async () => {
    const channel = new ControlChannel<string>();
    const d = deferred();
    const delivered: boolean[] = [];
    let firstActive = false;

    channel.subscribe(async (msg) => {
      if (msg === 'first') {
        firstActive = true;
        await d.promise;
        firstActive = false;
      } else {
        // If first handler were still active, ordering is violated.
        delivered.push(firstActive);
      }
    });

    channel.send('first');
    channel.send('second');

    d.resolve();
    await channel.drain();

    const expected = [false];
    const actual = delivered;
    expect(actual).toEqual(expected);
  });

  it('three messages with a slow handler are delivered in order', async () => {
    const channel = new ControlChannel<string>();
    const d = deferred();
    const order: string[] = [];

    channel.subscribe(async (msg) => {
      if (msg === 'a') {
        await d.promise;
      }
      order.push(msg);
    });

    channel.send('a');
    channel.send('b');
    channel.send('c');

    d.resolve();
    await channel.drain();

    const expected = ['a', 'b', 'c'];
    const actual = order;
    expect(actual).toEqual(expected);
  });

  it('two subscribers each receive all messages in send order independently', async () => {
    const channel = new ControlChannel<string>();
    const received1: string[] = [];
    const received2: string[] = [];

    channel.subscribe(async (msg) => {
      received1.push(msg);
    });
    channel.subscribe(async (msg) => {
      received2.push(msg);
    });

    channel.send('a');
    channel.send('b');

    await channel.drain();

    const expected = ['a', 'b'];
    // Both subscribers receive all messages in order (exception to one-assertion
    // rule: both test the same claim about independent subscriber ordering).
    expect(received1).toEqual(expected);
    expect(received2).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// FIFO order under send from inside a handler
// ---------------------------------------------------------------------------

describe('ControlChannel — FIFO order under send from inside a handler', () => {
  it('message sent from within a handler is delivered after the current queue is exhausted', async () => {
    const channel = new ControlChannel<string>();
    const order: string[] = [];

    channel.subscribe(async (msg) => {
      order.push(msg);
      if (msg === 'first') {
        // Re-entrant: enqueued to the tail of the queue.
        channel.send('second');
      }
    });

    channel.send('first');
    await channel.drain();

    const expected = ['first', 'second'];
    const actual = order;
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// drain()
// ---------------------------------------------------------------------------

describe('ControlChannel — drain()', () => {
  it('resolves immediately on a channel with no subscribers', async () => {
    const channel = new ControlChannel<string>();
    let resolved = false;

    channel.drain().then(() => {
      resolved = true;
    });
    await Promise.resolve();

    const expected = true;
    const actual = resolved;
    expect(actual).toBe(expected);
  });

  it('resolves immediately on an idle channel with a subscriber', async () => {
    const channel = new ControlChannel<string>();
    channel.subscribe(async () => {});
    let resolved = false;

    channel.drain().then(() => {
      resolved = true;
    });
    await Promise.resolve();

    const expected = true;
    const actual = resolved;
    expect(actual).toBe(expected);
  });

  it('resolves only after all queued messages have been delivered', async () => {
    const channel = new ControlChannel<string>();
    const d = deferred();
    let drainResolved = false;
    const delivered: string[] = [];

    channel.subscribe(async (msg) => {
      if (msg === 'slow') {
        await d.promise;
      }
      delivered.push(msg);
    });

    channel.send('slow');
    channel.send('fast');

    const drainPromise = channel.drain().then(() => {
      drainResolved = true;
    });

    await Promise.resolve();
    const expected1 = false;
    const actual1 = drainResolved;
    expect(actual1).toBe(expected1);

    d.resolve();
    await drainPromise;

    const expected2 = true;
    const actual2 = drainResolved;
    expect(actual2).toBe(expected2);
  });

  it('drain resolves after all handlers settle, not just when queue empties', async () => {
    const channel = new ControlChannel<string>();
    const d = deferred();
    let drainResolved = false;

    channel.subscribe(async () => {
      await d.promise;
    });

    channel.send('msg');
    const drainPromise = channel.drain().then(() => {
      drainResolved = true;
    });

    // Pump has dequeued the message (queue empty) but handler is not settled.
    await Promise.resolve();
    const expected1 = false;
    const actual1 = drainResolved;
    expect(actual1).toBe(expected1);

    d.resolve();
    await drainPromise;

    const expected2 = true;
    const actual2 = drainResolved;
    expect(actual2).toBe(expected2);
  });

  it('multiple concurrent drain calls all resolve when idle', async () => {
    const channel = new ControlChannel<string>();
    const d = deferred();
    const resolved: number[] = [];

    channel.subscribe(async () => {
      await d.promise;
    });
    channel.send('msg');

    const p1 = channel.drain().then(() => {
      resolved.push(1);
    });
    const p2 = channel.drain().then(() => {
      resolved.push(2);
    });

    d.resolve();
    await Promise.all([p1, p2]);

    const expected = 2;
    const actual = resolved.length;
    expect(actual).toBe(expected);
  });

  it('shutdown pattern: drain races against a timeout and timeout wins when handler stalls', async () => {
    const channel = new ControlChannel<string>();
    const d = deferred(); // never resolved — stalled handler
    channel.subscribe(async () => {
      await d.promise;
    });
    channel.send('msg');

    const timeout = new Promise<'timeout'>((res) => {
      setImmediate(() => res('timeout'));
    });
    const result = await Promise.race([channel.drain().then(() => 'drain' as const), timeout]);

    const expected = 'timeout';
    const actual = result;
    expect(actual).toBe(expected);

    d.resolve();
  });
});

// ---------------------------------------------------------------------------
// Handler error policy
// ---------------------------------------------------------------------------

describe('ControlChannel — handler error policy', () => {
  it('a handler that rejects does not stop delivery of subsequent messages', async () => {
    const channel = new ControlChannel<string>();
    const delivered: string[] = [];

    channel.subscribe(async (msg) => {
      if (msg === 'bad') {
        throw new Error('handler error');
      }
      delivered.push(msg);
    });

    channel.send('bad');
    channel.send('good');

    await channel.drain();

    const expected = ['good'];
    const actual = delivered;
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// send and drain after close()
// ---------------------------------------------------------------------------

describe('ControlChannel — send and drain after close()', () => {
  it('send after close throws', () => {
    const channel = new ControlChannel<string>();
    channel.subscribe(async () => {});
    channel.close();

    const actual = () => channel.send('msg');
    expect(actual).toThrow('Cannot send on a closed ControlChannel');
  });

  it('drain after close resolves when in-flight messages settle', async () => {
    const channel = new ControlChannel<string>();
    const d = deferred();
    let drainResolved = false;

    channel.subscribe(async () => {
      await d.promise;
    });
    channel.send('enqueued before close');
    channel.close();

    const drainPromise = channel.drain().then(() => {
      drainResolved = true;
    });
    d.resolve();
    await drainPromise;

    const expected = true;
    const actual = drainResolved;
    expect(actual).toBe(expected);
  });
});
