import { describe, expect, it } from 'vitest';
import { channel } from '../src/channel.js';

// What sits between one stage and the next. It holds bytes and nothing else: no separator, no
// encoding, no notion of a line. Its size is how far a writer may be ahead of its reader, which is
// the only thing it bounds — how much passes through it in total is nobody's business.

const SIZE = 64;

describe('a writer with a reader that has not read', () => {
  it('is allowed to write until the channel holds its size', async () => {
    const { write } = channel(SIZE);

    const accepted = await write(Buffer.alloc(SIZE));

    const expected = true;
    const actual = accepted;
    expect(actual).toBe(expected);
  });

  it('waits once the channel is full', async () => {
    const { write } = channel(SIZE);
    await write(Buffer.alloc(SIZE));

    let settled = false;
    void write(Buffer.alloc(1)).then(() => {
      settled = true;
    });
    await Promise.resolve();

    const expected = false;
    const actual = settled;
    expect(actual).toBe(expected);
  });

  it('is still waiting after a second buffer’s worth, rather than having taken it', async () => {
    const { write } = channel(SIZE);
    await write(Buffer.alloc(SIZE));

    let settled = false;
    void write(Buffer.alloc(SIZE)).then(() => {
      settled = true;
    });
    await Promise.resolve();

    const expected = false;
    const actual = settled;
    expect(actual).toBe(expected);
  });
});

describe('a reader taking bytes out', () => {
  it('lets the writer continue', async () => {
    const { write, read } = channel(SIZE);
    await write(Buffer.alloc(SIZE));
    let settled = false;
    void write(Buffer.alloc(1)).then(() => {
      settled = true;
    });

    await read();
    await Promise.resolve();

    const expected = true;
    const actual = settled;
    expect(actual).toBe(expected);
  });

  it('gets the bytes that were written, in order', async () => {
    const { write, read, end } = channel(SIZE);
    await write(Buffer.from('one'));
    await write(Buffer.from('two'));
    end();

    const expected = 'onetwo';
    const actual = Buffer.concat(await drain(read)).toString('utf8');
    expect(actual).toBe(expected);
  });

  it('gets the rest of a write it only partly took', async () => {
    const { write, read, end } = channel(SIZE);
    await write(Buffer.from('abcdef'));
    end();

    const first = await read(2);
    const rest = Buffer.concat(await drain(read));

    const expected = 'ab|cdef';
    const actual = `${first?.toString('utf8')}|${rest.toString('utf8')}`;
    expect(actual).toBe(expected);
  });

  it('sees the end once the writer has finished and nothing is left', async () => {
    const { write, read, end } = channel(SIZE);
    await write(Buffer.from('x'));
    end();
    await read();

    const expected = undefined;
    const actual = await read();
    expect(actual).toBe(expected);
  });
});

// A pipeline moves far more than it ever holds. What is bounded is the distance between the two
// ends, never the total.
describe('a writer producing far more than the channel holds', () => {
  it('is made to wait on every write once the reader falls behind', async () => {
    const { write, read } = channel(SIZE);
    await write(Buffer.alloc(SIZE));
    let waited = 0;

    for (let round = 0; round < 100; round++) {
      let settled = false;
      const writing = write(Buffer.alloc(SIZE)).then((accepted) => {
        settled = true;
        return accepted;
      });
      await Promise.resolve();
      waited += settled ? 0 : 1;
      await read();
      await writing;
    }

    const expected = 100;
    const actual = waited;
    expect(actual).toBe(expected);
  });

  it('is never refused for how much it has written in total', async () => {
    const { write, read } = channel(SIZE);
    let accepted = true;

    for (let round = 0; round < 100; round++) {
      const writing = write(Buffer.alloc(SIZE));
      await read();
      accepted = accepted && (await writing);
    }

    const expected = true;
    const actual = accepted;
    expect(actual).toBe(expected);
  });
});

// The size bounds how far ahead a writer may be, not what a single write may contain.
describe('one write larger than the channel', () => {
  it('is accepted', async () => {
    const { write, read } = channel(SIZE);

    const writing = write(Buffer.alloc(SIZE * 10));
    await read();

    const expected = true;
    const actual = writing != null;
    expect(actual).toBe(expected);
  });

  it('is delivered whole', async () => {
    const { write, read, end } = channel(SIZE);
    const big = Buffer.alloc(SIZE * 10, 7);

    void write(big).then(() => end());
    const taken = Buffer.concat(await drain(read));

    const expected = big.length;
    const actual = taken.length;
    expect(actual).toBe(expected);
  });
});

describe('bytes with no structure to them', () => {
  it('arrive exactly as they were sent', async () => {
    const { write, read, end } = channel(1024);
    const bytes = Buffer.from([0x00, 0xff, 0x0a, 0x80, 0xc3, 0x28, 0x0d]);

    await write(bytes);
    end();

    const expected = bytes.toString('hex');
    const actual = Buffer.concat(await drain(read)).toString('hex');
    expect(actual).toBe(expected);
  });

  it('are not divided on any separator', async () => {
    const { write, read, end } = channel(1024);

    await write(Buffer.from('a\nb\nc'));
    end();

    const expected = 'a\nb\nc';
    const actual = Buffer.concat(await drain(read)).toString('utf8');
    expect(actual).toBe(expected);
  });
});

describe('a reader that stops', () => {
  it('stops the writer waiting on a full channel', async () => {
    const { write, close } = channel(SIZE);
    await write(Buffer.alloc(SIZE));
    const blocked = write(Buffer.alloc(1));

    close();

    const expected = false;
    const actual = await blocked;
    expect(actual).toBe(expected);
  });

  it('refuses anything written afterwards', async () => {
    const { write, close } = channel(SIZE);
    close();

    const expected = false;
    const actual = await write(Buffer.from('x'));
    expect(actual).toBe(expected);
  });
});

describe('a writer that fails', () => {
  it('makes the reader see the failure rather than a clean end', async () => {
    const { fail, read } = channel(SIZE);
    const boom = new Error('producer exploded');

    fail(boom);

    const expected = boom;
    const actual = await read().catch((err: unknown) => err);
    expect(actual).toBe(expected);
  });

  it('leaves what was already written readable first', async () => {
    const { write, fail, read } = channel(SIZE);
    await write(Buffer.from('before'));

    fail(new Error('producer exploded'));

    const expected = 'before';
    const actual = (await read())?.toString('utf8');
    expect(actual).toBe(expected);
  });
});

async function drain(read: (max?: number) => Promise<Buffer | undefined>): Promise<Buffer[]> {
  const taken: Buffer[] = [];
  for (let chunk = await read(); chunk != null; chunk = await read()) {
    taken.push(chunk);
  }
  return taken;
}
