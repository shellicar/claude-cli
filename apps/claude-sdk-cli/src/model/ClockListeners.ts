import { IRequestClockListener, IToolsClockListener } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { ITurnClock } from './ITurnClock.js';

/** Binds the request layer's edges to the clock. `kept` is the 2xx outcome. */
export class RequestClockAdapter extends IRequestClockListener {
  @dependsOn(ITurnClock) private readonly clock!: ITurnClock;

  public requestStarted(): void {
    this.clock.claudeStart();
  }
  public requestSettled(kept: boolean): void {
    this.clock.claudeStop(kept);
  }
}

/** Binds the tools layer's edges to the clock. */
export class ToolsClockAdapter extends IToolsClockListener {
  @dependsOn(ITurnClock) private readonly clock!: ITurnClock;

  public toolsStarted(): void {
    this.clock.toolsStart();
  }
  public toolsStopped(): void {
    this.clock.toolsStop();
  }
}
