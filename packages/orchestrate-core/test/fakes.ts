import type { ApprovalContext, ApprovalOutcome } from '../src/run.js';
import type { Stage, Tool, ToolResult } from '../src/types.js';

/** Decides by stage name, and remembers what it was asked about. */
export class FakeApprover {
  public readonly asked: ApprovalContext[] = [];
  public readonly shown: unknown[] = [];

  public constructor(private readonly verdicts: Record<string, ApprovalOutcome> = {}) {}

  public decide = async (ctx: ApprovalContext): Promise<ApprovalOutcome> => {
    this.asked.push(ctx);
    return this.verdicts[ctx.name] ?? { verdict: 'allow' };
  };

  /** Decides like `decide`, and asks to see what the stage would act on first. */
  public look = async (ctx: ApprovalContext): Promise<ApprovalOutcome> => {
    this.shown.push(await ctx.batch());
    return this.decide(ctx);
  };

  public names(): string[] {
    return this.asked.map((ctx) => ctx.name);
  }
}

/** Resolves when the test says so, rather than when time passes. */
export class FakeSleep {
  #wake: (() => void) | undefined;

  public sleep = (_ms: number, signal: AbortSignal): Promise<void> =>
    new Promise<void>((resolve) => {
      this.#wake = resolve;
      signal.addEventListener('abort', () => resolve(), { once: true });
    });

  /** The delay elapses. */
  public elapse(): void {
    this.#wake?.();
    this.#wake = undefined;
  }
}

type ToolBehaviour = {
  /** What it writes, in the order given. */
  writes?: string[];
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
};

/** A tool that does what the test told it to, and records what happened to it. */
export class FakeTool {
  public ran = false;
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
      run: (_input, upstream, channel) => {
        this.ran = true;
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
      const bytes = Buffer.from(value);
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
