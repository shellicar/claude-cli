import { dependsOn } from '@shellicar/core-di';
import { StatusState } from './StatusState.js';

/**
 * The tool-availability mode command mode cycles through `o`: `normal` offers every tool the
 * config/az-account state would otherwise allow; `readOnly` narrows the wire tool list to only
 * `read`/`ephemeral.read` operations (see `isReadOperation`) — Claude can look, not act, useful
 * for "let's agree what to do before you go do it"; `noTools` narrows it to nothing, for "stop
 * calling tools and talk to me." Cycling is a session-only concern: it does not persist across a
 * restart the way the tool-availability reminder does.
 */
export type ToolMode = 'normal' | 'readOnly' | 'noTools';

const TOOL_MODE_CYCLE: readonly ToolMode[] = ['normal', 'readOnly', 'noTools'];

export abstract class ToolModeState {
  public abstract get mode(): ToolMode;
  public abstract cycle(): void;
}

export class ToolModeSettings extends ToolModeState {
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  #mode: ToolMode = 'normal';

  public get mode(): ToolMode {
    return this.#mode;
  }

  public cycle(): void {
    const idx = TOOL_MODE_CYCLE.indexOf(this.#mode);
    this.#mode = TOOL_MODE_CYCLE[(idx + 1) % TOOL_MODE_CYCLE.length] ?? 'normal';
    this.statusState.setToolMode(this.#mode);
  }
}
