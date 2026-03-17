import { execCommand } from './execCommand';
import { execPipeline } from './execPipeline';
import type { Step, StepResult } from './types';

/** Execute a single step (command or pipeline). */
export async function execStep(step: Step, cwd: string, timeoutMs?: number): Promise<StepResult> {
  if (step.type === 'command') {
    const { type: _, ...cmd } = step;
    return execCommand(cmd, cwd, timeoutMs);
  }
  return execPipeline(step.commands, cwd, timeoutMs);
}
