import type { ToolBlockLifetime } from '../public/types';
import { IToolBlockNotifier } from '../public/types';

export class ToolBlockNotifier extends IToolBlockNotifier {
  readonly #lifetimes: readonly ToolBlockLifetime[];

  public constructor(lifetimes: readonly ToolBlockLifetime[]) {
    super();
    this.#lifetimes = lifetimes;
  }

  public async blockEnded(): Promise<void> {
    // allSettled, not all: a rejecting lifetime must not stop the others being
    // torn down, nor throw out of QueryRunner's finally and skip toolsStopped().
    await Promise.allSettled(this.#lifetimes.map((l) => l.blockEnded()));
  }
}
