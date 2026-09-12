import { channel, type Ended, type Tool } from '@shellicar/orchestrate-core';

// Plumbing for a tool that reads what is piped into it. Only the plumbing: what each of them
// promises is stated in its own spec, because the same input means a different thing to each.

/** An upstream handing over the chunks it was given, remembering how many were taken. Chunk
 *  boundaries are the point: a line can be split across two, and the answer must not depend on it. */
export class Upstream {
  public taken = 0;
  public constructor(private readonly chunks: Buffer[]) {}
  public read = async (): Promise<Buffer | undefined> => {
    const next = this.chunks[this.taken];
    if (next == null) {
      return undefined;
    }
    this.taken++;
    return next;
  };
}

export type Ran = {
  output: string;
  said: string[];
  ended: Ended;
  /** How many chunks were taken from upstream before it stopped reading. */
  taken: number;
  /** How many there were to take. */
  available: number;
};

/** Runs one tool over the given chunks. `undefined` chunks means nothing was piped in at all, which
 *  is what a tool called on its own rather than in a pipe receives. */
export async function ran(tool: Tool, input: Record<string, unknown>, chunks?: (string | Buffer)[]): Promise<Ran> {
  const upstream = chunks == null ? undefined : new Upstream(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'))));
  const out = channel(64 * 1024);
  const said: string[] = [];

  const running = tool.run(
    input,
    upstream,
    out,
    (line) => void said.push(line),
    () => {},
  );

  const taken: Buffer[] = [];
  for (let chunk = await out.read(); chunk != null; chunk = await out.read()) {
    taken.push(chunk);
  }
  await running.stop();
  return { output: Buffer.concat(taken).toString('utf8'), said, ended: running.ended(), taken: upstream?.taken ?? 0, available: chunks?.length ?? 0 };
}
