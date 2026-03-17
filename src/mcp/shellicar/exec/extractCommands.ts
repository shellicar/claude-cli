import type { Command, Step } from './types';

/** Extract all commands from a step (flattens pipelines). */
export function extractCommands(step: Step): Command[] {
  if (step.type === 'command') {
    const { type: _, ...cmd } = step;
    return [cmd];
  }
  return step.commands;
}
