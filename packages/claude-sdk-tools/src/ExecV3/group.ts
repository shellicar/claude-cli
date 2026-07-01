import type { Command } from './types';

export interface Pipeline {
  /** The commands in this pipeline stage-order; length ≥ 1. */
  commands: Command[];
  /** Original indices in the input list, for position-indexed results. */
  indices: number[];
}

export interface Grouped {
  pipelines: Pipeline[];
  /** connectors[k] joins pipelines[k] to pipelines[k+1]; '&&' | '||' | undefined (sequential). length = pipelines.length - 1 */
  connectors: Array<'&&' | '||' | undefined>;
}

/** Split the flat list into pipelines (maximal `|` runs) and the connectors between them. */
export function group(commands: Command[]): Grouped {
  const pipelines: Pipeline[] = [];
  const connectors: Array<'&&' | '||' | undefined> = [];
  let current: Pipeline = { commands: [], indices: [] };

  commands.forEach((cmd, i) => {
    current.commands.push(cmd);
    current.indices.push(i);
    if (cmd.op === '|') {
      return; // next command continues this pipeline
    }
    // op is '&&' | '||' | undefined → this pipeline ends here
    pipelines.push(current);
    if (i < commands.length - 1) {
      connectors.push(cmd.op as '&&' | '||' | undefined);
    }
    current = { commands: [], indices: [] };
  });

  return { pipelines, connectors };
}
