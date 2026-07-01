import type { IExecutor } from '@shellicar/exec-core';
import { group } from './group';
import { runPipeline } from './runPipeline';
import type { Command, CommandResult, ExecV3Output } from './types';

export interface EngineContext {
  cwd: string;
  signal: AbortSignal | undefined;
  executor: IExecutor;
}

/**
 * Execute the flat command list under bash list semantics. `results` is allocated to
 * commands.length and position-aligned (results[i] ↔ commands[i]); a short-circuited
 * command is left `null`. Short-circuit is skip-and-continue: a skipped pipeline fills
 * its slots with `null`, carries `$?` unchanged, and the loop continues — so a sequential
 * step after a short-circuited chain still runs, exactly as bash does.
 */
export async function evaluate(commands: Command[], ctx: EngineContext): Promise<ExecV3Output> {
  const { pipelines, connectors } = group(commands);
  const results: (CommandResult | null)[] = new Array(commands.length).fill(null);
  let lastExit: number | null = 0;

  for (let k = 0; k < pipelines.length; k++) {
    const pipeline = pipelines[k];

    let run = true;
    if (k > 0) {
      const connector = connectors[k - 1];
      if (connector === '&&') {
        run = lastExit === 0;
      } else if (connector === '||') {
        run = lastExit !== 0;
      }
      // undefined (sequential) → always run
    }

    if (!run) {
      // skipped pipeline: slots stay null, $? carries unchanged, continue (do NOT break)
      continue;
    }

    const stageResults = await runPipeline(pipeline.commands, ctx);
    pipeline.indices.forEach((idx, s) => {
      results[idx] = stageResults[s];
    });
    lastExit = stageResults[stageResults.length - 1].exitCode;
  }

  return { results, success: lastExit === 0 };
}
