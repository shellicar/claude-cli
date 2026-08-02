import type { ApprovalContext, ApprovalOutcome } from '../src/run.js';
import type { Stage, Tool, ToolResult } from '../src/types.js';

/** Decides by stage name, and remembers what it was asked about. */
export class FakeApprover {
  public readonly asked: ApprovalContext[] = [];
  /** What it was shown, by the stage it was shown for. */
  public readonly shown = new Map<string, Buffer>();

  public constructor(private readonly verdicts: Record<string, ApprovalOutcome> = {}) {}

  public decide = async (ctx: ApprovalContext): Promise<ApprovalOutcome> => {
    this.asked.push(ctx);
    return this.verdicts[ctx.name] ?? { verdict: 'allow' };
  };

  /** Decides like `decide`, and asks to see what the stage would act on first. */
  public look = async (ctx: ApprovalContext): Promise<ApprovalOutcome> => {
    this.shown.set(ctx.name, await ctx.batch());
    return this.decide(ctx);
  };

  public names(): string[] {
    return this.asked.map((ctx) => ctx.name);
  }
}

/** Resolves when the test says so, rather than when time passes. A delay asked for after the test
 *  said so has already elapsed: otherwise a test would have to know when the run got round to
 *  asking, and would pass or hang depending on that. */
export class FakeSleep {
  #elapsed = false;
  #waiting: (() => void)[] = [];

  public sleep = (_ms: number, signal: AbortSignal): Promise<void> =>
    new Promise<void>((resolve) => {
      if (this.#elapsed) {
        resolve();
        return;
      }
      this.#waiting.push(resolve);
      signal.addEventListener('abort', () => resolve(), { once: true });
    });

  /** The delay elapses, whether or not anything has asked for one yet. */
  public elapse(): void {
    this.#elapsed = true;
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const resolve of waiting) {
      resolve();
    }
  }
}

type ToolBehaviour = {
  /** What it writes, in the order given. */
  writes?: (string | Buffer)[];
  /** How it answers for itself once it is finished with. Defaults to finished. */
  ends?: ToolResult['ended'];
  /** Throws instead of producing anything. */
  throws?: Error;
  /** Writes without end. */
  endless?: boolean;
  /** Passes on whatever it read, rather than writing its own. */
  echoes?: boolean;
  /** Waits for this before writing anything more. */
  waitsFor?: Promise<void>;
  /** The field an argument list is put into, for a tool that takes one. */
  takesListIn?: string;
};

/** A tool that does what the test told it to, and records what happened to it. */
export class FakeTool {
  public ran = false;
  /** The input it was actually given. */
  public input: Record<string, unknown> = {};
  public readonly received: Buffer[] = [];
  public readonly written: Buffer[] = [];
  public stopped = false;

  public constructor(
    public readonly name: string,
    private readonly behaviour: ToolBehaviour = {},
  ) {}

  public get tool(): Tool {
    return {
      name: this.name,
      operations: () => ['none'],
      ...(this.behaviour.takesListIn != null ? { takesListIn: this.behaviour.takesListIn } : {}),
      run: (input, upstream, channel) => {
        this.ran = true;
        this.input = input;
        void this.#produce(upstream, channel);
        return {
          ended: () => this.behaviour.ends ?? { kind: 'finished' },
          stop: async () => {
            this.stopped = true;
          },
        };
      },
    };
  }

  async #produce(upstream: { read: () => Promise<Buffer | undefined> } | undefined, out: { write: (bytes: Buffer) => Promise<boolean>; end: () => void; fail: (err: unknown) => void }): Promise<void> {
    if (this.behaviour.throws) {
      out.fail(this.behaviour.throws);
      return;
    }
    if (this.behaviour.echoes && upstream != null) {
      for (let chunk = await upstream.read(); chunk != null; chunk = await upstream.read()) {
        this.received.push(chunk);
        if (!(await out.write(chunk))) {
          return;
        }
      }
      out.end();
      return;
    }
    if (this.behaviour.endless) {
      for (let index = 0; ; index++) {
        const bytes = Buffer.from(`line${index}\n`);
        this.written.push(bytes);
        if (!(await out.write(bytes))) {
          return;
        }
      }
    }
    for (const value of this.behaviour.writes ?? []) {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
      this.written.push(bytes);
      if (!(await out.write(bytes))) {
        return;
      }
      if (this.behaviour.waitsFor != null) {
        await this.behaviour.waitsFor;
      }
    }
    out.end();
  }
}

export function stage(tool: FakeTool, op?: Stage['op'], input: Record<string, unknown> = {}): Stage {
  return { kind: 'tool', tool: tool.tool, input, op };
}
