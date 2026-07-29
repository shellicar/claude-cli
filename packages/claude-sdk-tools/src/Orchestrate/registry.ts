import type { BetaTool } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { Clock } from '@js-joda/core';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import type { SipsBridge } from '@shellicar/claude-core/image/SipsBridge';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import { withResolvedPaths } from '@shellicar/claude-sdk';
import type { IExecutor } from '@shellicar/exec-core';
import type { Op, Stage, ToolV2 } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import type { AzSessionCache } from '../Az/AzSessionCache.js';
import type { AzDeps } from '../Az/runAz.js';
import type { AzAccountsConfig } from '../Az/tools.js';
import type { AdoEscalatedDeps } from '../AzureDevOps/runAdoEscalated.js';
import type { IEnvProvider } from '../exec-shared.js';
import type { GhEscalatedDeps } from '../GitHub/runGhEscalated.js';
import type { RefStore } from '../RefStore/RefStore.js';
import type { ToolV2Definition } from './defineToolV2.js';
import { createAppendFileToolV2 } from './tools/AppendFile.js';
import { createAzToolsV2 } from './tools/Az.js';
import { createAdoPrToolsV2 } from './tools/AzureDevOps.js';
import { createCreateFileToolV2 } from './tools/CreateFile.js';
import { createDeleteToolV2 } from './tools/Delete.js';
import { createDeleteMemoryToolV2 } from './tools/DeleteMemory.js';
import { createEditFileToolV2 } from './tools/EditFile.js';
import { createFindToolV2 } from './tools/Find.js';
import { createGhPrToolsV2 } from './tools/GitHub.js';
import { createHeadToolV2 } from './tools/Head.js';
import { createMatchToolV2 } from './tools/Match.js';
import { createMemoryTypesToolV2 } from './tools/MemoryTypes.js';
import { createPathsToolV2 } from './tools/Paths.js';
import { createProgramToolV2 } from './tools/Program.js';
import { createRangeToolV2 } from './tools/Range.js';
import { createReadToolV2 } from './tools/Read.js';
import { createReadBinaryFileToolV2 } from './tools/ReadBinaryFile.js';
import { createReadHistoryToolV2 } from './tools/ReadHistory.js';
import { createReadMemoryToolV2 } from './tools/ReadMemory.js';
import { createRefToolV2 } from './tools/Ref.js';
import { createSearchHistoryToolV2 } from './tools/SearchHistory.js';
import { createSearchMemoryToolV2 } from './tools/SearchMemory.js';
import { createSkillToolV2 } from './tools/Skill.js';
import { createTailToolV2 } from './tools/Tail.js';
import { createTsToolsV2 } from './tools/TypeScript.js';
import { createWriteMemoryToolV2 } from './tools/WriteMemory.js';

export type ToolsV2RegistryDeps = {
  fs: IFileSystem;
  executor: IExecutor;
  refStore: RefStore;
  sips: SipsBridge;
  logger: ILogger;
  memoryStore: IMemoryStore;
  historyReader: IHistoryReader;
  currentSessionId: () => string;
  clock: Clock;
  skillDirs: readonly string[];
  ghDeps: GhEscalatedDeps;
  adoDeps: AdoEscalatedDeps;
  azDeps: AzDeps;
  azSessionCache: AzSessionCache;
  getAzAccounts: () => AzAccountsConfig;
  /** The environment every `Program` call runs under — the same provider ExecV3 uses, so a V2 exec
   *  gets the same credential stripping, and the same variables are available to expand in `args`. */
  envProvider: IEnvProvider;
  /** Resolves a marked path field to a single absolute form (expand `~`/`$VAR`, then resolve
   *  against cwd) — the same contract V1's `ToolRegistry` takes, so both consumers share one
   *  real implementation. Defaults to identity when omitted. */
  expand?: (p: string) => string;
};

// Forward-pointing join to the NEXT stage — absent means sequential (`;`), matching
// orchestrate-core's `Op` and ExecV3's own convention.
const OpSchema = z.enum(['|', '&&', '||']);

const XargsStageSchema = z.object({ xargs: z.string().describe('Parameter name on the NEXT stage to inject the collected upstream values into') });

export type WireStage = { tool: string; input: unknown; op?: Op; showStderr?: boolean; captureAs?: string } | { xargs: string };

/** Every V2 tool Orchestrate can run, and the one place the wire tools array and Orchestrate's
 *  own stage validation both come from. Each tool is self-describing (its own `model`), so
 *  there is exactly one schema per tool, never a second hand-copied one — the bug the previous
 *  pass of this file had, where the stage schema was a separate, manually-kept-in-lockstep
 *  list. This is Orchestrate's own registry, not V1's `ToolRegistry` — a genuinely separate
 *  system, per the Tools V2 decision. */
export class ToolsV2Registry {
  readonly #defs: Map<string, ToolV2Definition<z.ZodType>>;
  readonly #stageSchema: z.ZodType<WireStage>;
  readonly #expand: (p: string) => string;
  /** The ambient environment a run clones its own variable overlay from (see `runToolV2Call`). */
  public readonly envProvider: IEnvProvider;

  /** `expand` defaults to identity so the many `new ToolsV2Registry(defs)` call sites (tests)
   *  keep compiling and behave unchanged — the composition root injects the real cwd/~/$VAR
   *  resolver, same contract as V1's `ToolRegistry`. */
  public constructor(defs: ToolV2Definition<z.ZodType>[], expand: (p: string) => string = (p) => p, envProvider: IEnvProvider = { buildEnv: (cmdEnv) => ({ ...process.env, ...cmdEnv }) }) {
    this.#defs = new Map(defs.map((d) => [d.name, d]));
    this.#expand = expand;
    this.envProvider = envProvider;
    const stageVariants = defs
      .filter((d) => !d.excludeFromStages)
      .map((d) =>
        z.object({
          tool: z.literal(d.name),
          input: d.model,
          op: OpSchema.optional(),
          showStderr: z.boolean().optional(),
          captureAs: z.string().regex(/^\w+$/).optional().describe("Store this stage's output in a variable of this name, instead of only piping it. A later stage reads it as $NAME anywhere in its own input, and a spawned process sees it as a real environment variable. The variable lives for this call only."),
        }),
      );
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
   *  from every registered tool's own `model`, plus `Xargs`. Generated, not hand-authored.
   *  Rejects a trailing `op` on the last stage — there is nothing after it to join to, so it
   *  can only be a mistake, same as ExecV3's own dangling-operator validation. */
  public get stageSchema(): z.ZodType<{ stages: WireStage[] }> {
    return z.object({ stages: z.array(this.#stageSchema).min(1) }).refine(
      (v) => {
        const last = v.stages[v.stages.length - 1];
        return !('op' in last) || last.op == null;
      },
      {
        message: 'The last stage must not have an op set — there is nothing after it to join to.',
        path: ['stages'],
      },
    );
  }

  public get(name: string): ToolV2Definition<z.ZodType> | undefined {
    return this.#defs.get(name);
  }

  /** Resolves one already-parsed wire stage into a real `orchestrate-core` `Stage`, validating
   *  the stage's own `input` against its tool's `model` (not a second schema), then giving the
   *  tool's own `resolveDefaults` a chance to fill in anything it knows from its own injected
   *  dependency (e.g. `Program.cwd` defaulting to `fs.cwd()`) — the resolved value this
   *  produces is what Policy sees, the same as an explicitly-supplied one. Throws on a name
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
    const resolvedInput = def.resolveDefaults ? def.resolveDefaults(parsedInput) : parsedInput;
    const captureAs = wire.captureAs;
    const model = def.model;
    const expand = this.#expand;
    // Wraps def.run so it always executes against a path-resolved COPY of whatever `execute()`
    // hands it — approval/display/logging see the untouched value execute() itself passes to
    // approve(); only this wrapper's own call to def.run ever sees the expanded form.
    const run: ToolV2<unknown, unknown>['run'] = (input, upstream, stderr, signal, scope, env) => def.run(withResolvedPaths(model, input, expand), upstream, stderr, signal, scope as Parameters<typeof def.run>[4], env as Parameters<typeof def.run>[5]) as ReturnType<ToolV2<unknown, unknown>['run']>;
    const tool: ToolV2<unknown, unknown> = { name: def.name, operation: def.operation, run };
    return { kind: 'tool', tool, input: resolvedInput as Record<string, unknown>, op: wire.op, showStderr: wire.showStderr, captureAs };
  }
}

/** Builds the registry with every real V2 tool wired to its dependencies. */
export function createToolsV2Registry(deps: ToolsV2RegistryDeps): ToolsV2Registry {
  return new ToolsV2Registry(
    [
      createFindToolV2(deps.fs),
      createPathsToolV2(deps.fs),
      createMatchToolV2(),
      createHeadToolV2(),
      createTailToolV2(),
      createRangeToolV2(),
      createReadToolV2(deps.fs),
      createReadBinaryFileToolV2(deps.fs, deps.sips, deps.logger),
      createProgramToolV2(deps.executor, deps.fs, deps.envProvider),
      createDeleteToolV2(deps.fs),
      createRefToolV2(deps.refStore),
      createCreateFileToolV2(deps.fs),
      createAppendFileToolV2(deps.fs),
      createEditFileToolV2(deps.fs),
      createWriteMemoryToolV2(deps.memoryStore),
      createReadMemoryToolV2(deps.memoryStore),
      createSearchMemoryToolV2(deps.memoryStore),
      createDeleteMemoryToolV2(deps.memoryStore),
      createMemoryTypesToolV2(deps.memoryStore),
      createSearchHistoryToolV2(deps.historyReader, deps.currentSessionId, deps.clock),
      createReadHistoryToolV2(deps.historyReader),
      createSkillToolV2(deps.fs, deps.skillDirs, deps.logger),
      ...createGhPrToolsV2(deps.ghDeps),
      ...createAdoPrToolsV2(deps.adoDeps, deps.getAzAccounts, deps.azSessionCache),
      ...createAzToolsV2(deps.azDeps, deps.getAzAccounts, deps.azSessionCache),
      ...createTsToolsV2(),
    ],
    deps.expand,
    deps.envProvider,
  );
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
