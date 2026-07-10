import { IToolBlockNotifier } from '../public/types';
import type { ToolBlockLifetime } from '../public/types';

export class ToolBlockNotifier extends IToolBlockNotifier {
  readonly #lifetimes: readonly ToolBlockLifetime[];

  public constructor(lifetimes: readonly ToolBlockLifetime[]) {
    super();
    this.#lifetimes = lifetimes;
  }

  public async blockEnded(): Promise<void> {
    await Promise.all(this.#lifetimes.map((l) => l.blockEnded()));
  }
}
