import { execStep } from './execStep';
import type { ExecInput, ExecOutput } from './types';

/** Execute all steps according to the chaining strategy. */
export async function execute(input: ExecInput, cwd: string): Promise<ExecOutput> {
  // independent: all steps run concurrently — no step waits for another
  if (input.chaining === 'independent') {
    const results = await Promise.all(input.steps.map((step) => execStep(step, cwd, input.timeout)));
    const success = results.every((r) => r.exitCode === 0);
    return { results, success };
  }

  // sequential / bail_on_error: steps run one at a time
  const results = [];
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
