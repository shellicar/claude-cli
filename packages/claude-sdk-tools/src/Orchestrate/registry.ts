import type { BetaTool } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IExecutor } from '@shellicar/exec-core';
import type { Op, Stage, ToolV2 } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import type { ToolV2Definition } from './defineToolV2.js';
import { createFindToolV2 } from './tools/Find.js';
import { createHeadToolV2 } from './tools/Head.js';
import { createMatchToolV2 } from './tools/Match.js';
import { createProgramToolV2 } from './tools/Program.js';
import { createPathsToolV2 } from './tools/Paths.js';
import { createRangeToolV2 } from './tools/Range.js';
import { createReadToolV2 } from './tools/Read.js';
import { createTailToolV2 } from './tools/Tail.js';

export type ToolsV2RegistryDeps = {
  fs: IFileSystem;
  executor: IExecutor;
};

// Forward-pointing join to the NEXT stage — absent means sequential (`;`), matching
// orchestrate-core's `Op` and ExecV3's own convention.
const OpSchema = z.enum(['|', '&&', '||']);

const XargsStageSchema = z.object({ xargs: z.string().describe('Parameter name on the NEXT stage to inject the collected upstream values into') });

export type WireStage = { tool: string; input: unknown; op?: Op; showStderr?: boolean } | { xargs: string };

/** Every V2 tool Orchestrate can run, and the one place the wire tools array and Orchestrate's
 *  own stage validation both come from. Each tool is self-describing (its own `model`), so
 *  there is exactly one schema per tool, never a second hand-copied one — the bug the previous
 *  pass of this file had, where the stage schema was a separate, manually-kept-in-lockstep
 *  list. This is Orchestrate's own registry, not V1's `ToolRegistry` — a genuinely separate
 *  system, per the Tools V2 decision. */
export class ToolsV2Registry {
  readonly #defs: Map<string, ToolV2Definition<z.ZodType>>;
  readonly #stageSchema: z.ZodType<WireStage>;

  public constructor(defs: ToolV2Definition<z.ZodType>[]) {
    this.#defs = new Map(defs.map((d) => [d.name, d]));
    const stageVariants = defs.map((d) => z.object({ tool: z.literal(d.name), input: d.model, op: OpSchema.optional(), showStderr: z.boolean().optional() }));
    this.#stageSchema = z.union([z.discriminatedUnion('tool', stageVariants as unknown as [z.ZodObject, ...z.ZodObject[]]), XargsStageSchema]) as z.ZodType<WireStage>;
  }

  /** Every registered tool gets its own wire entry, same as V1's `Find`/`Paths` sources are
   *  both a pipe step and standalone-callable — a V2 tool is genuinely a tool, callable
   *  directly, not merely a shape hidden inside Orchestrate's own schema. */
  public get wireTools(): BetaTool[] {
    return Array.from(this.#defs.values()).map((d) => ({
      name: d.name,
      description: d.description,
      input_schema: d.model.toJSONSchema({ target: 'draft-07', io: 'input' }) as BetaTool['input_schema'],
    }));
  }

  /** The `stages` array shape Orchestrate's own wire tool takes — a discriminated union built
   *  from every registered tool's own `model`, plus `Xargs`. Generated, not hand-authored. */
  public get stageSchema(): z.ZodType<{ stages: WireStage[] }> {
    return z.object({ stages: z.array(this.#stageSchema).min(1) });
  }

  public get(name: string): ToolV2Definition<z.ZodType> | undefined {
    return this.#defs.get(name);
  }

  /** Resolves one already-parsed wire stage into a real `orchestrate-core` `Stage`, validating
   *  the stage's own `input` against its tool's `model` (not a second schema). Throws on a name
   *  outside the registry — the discriminated union already makes that a parse error before
   *  this is ever reached, so reaching it with an unknown name is a real bug, not user input. */
  public toStage(wire: WireStage): Stage {
    if ('xargs' in wire) {
      return { kind: 'xargs', parameter: wire.xargs };
    }
    const def = this.#defs.get(wire.tool);
    if (def == null) {
      throw new Error(`Orchestrate: "${wire.tool}" is not in the Tools V2 registry`);
    }
    const parsedInput = def.model.parse(wire.input);
    const tool: ToolV2<unknown, unknown> = { name: def.name, operation: def.operation, run: def.run as ToolV2<unknown, unknown>['run'] };
    return { kind: 'tool', tool, input: parsedInput as Record<string, unknown>, op: wire.op, showStderr: wire.showStderr };
  }
}

/** Builds the registry with every real V2 tool wired to its dependencies. */
export function createToolsV2Registry(deps: ToolsV2RegistryDeps): ToolsV2Registry {
  return new ToolsV2Registry([createFindToolV2(deps.fs), createPathsToolV2(deps.fs), createMatchToolV2(), createHeadToolV2(), createTailToolV2(), createRangeToolV2(), createReadToolV2(deps.fs), createProgramToolV2(deps.executor)]);
}

/** Every wire entry Tools V2 contributes to the model's tools array: every registered tool
 *  individually (so `Find` is directly callable, same as V1's `Find`/`Paths` pipe sources are),
 *  plus `Orchestrate` itself, whose `stages` schema is generated from those same tools —
 *  nothing here is a second, hand-authored copy of any tool's shape. */
export function toolsV2WireTools(registry: ToolsV2Registry): BetaTool[] {
  const orchestrate: BetaTool = {
    name: 'Orchestrate',
    description: 'Runs a sequence of Tools V2 tools, joined by | (pipe stdout into the next stage) / && / || (gate on success/failure) / absent (sequential). Composes any registered tool with any other.',
    input_schema: registry.stageSchema.toJSONSchema({ target: 'draft-07', io: 'input' }) as BetaTool['input_schema'],
  };
  return [...registry.wireTools, orchestrate];
}
