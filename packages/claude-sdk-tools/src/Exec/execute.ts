import { execStep } from './execStep';
import type { ExecInput, ExecOutput, StepResult } from './types';

/** Execute all steps according to the chaining strategy. */
export async function execute(input: ExecInput, cwd: string): Promise<ExecOutput> {
  const results: StepResult[] = [];

  for (const step of input.steps) {
    const result = await execStep(step, cwd, input.timeout);
    results.push(result);

    if (input.chaining === 'bail_on_error' && result.exitCode !== 0) {
      return { results, success: false };
    }
  }

  const success = results.every((r) => r.exitCode === 0);
  return { results, success };
}
