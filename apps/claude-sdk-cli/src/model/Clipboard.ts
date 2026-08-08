import { osc52 } from '@shellicar/claude-core/ansi';
import { Screen } from '@shellicar/claude-core/screen';
import { dependsOn } from '@shellicar/core-di';

/** The state's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IClipboard {
  public abstract write(text: string): void;
}

/**
 * Puts text on the system clipboard by asking the terminal to do it, which works whether
 * the CLI is on the same machine as the clipboard or at the far end of a connection.
 *
 * The sequence is a one-shot command, not content: it occupies no cell, so it goes
 * straight out through the screen and never enters a rendered row or the frame diff.
 */
export class Osc52Clipboard extends IClipboard {
  @dependsOn(Screen) private readonly screen!: Screen;

  public write(text: string): void {
    this.screen.write(osc52(text));
  }
}
