/**
 * Pure editor state — lines of text and cursor position.
 * No rendering, no key handling, no I/O.
 *
 * AppLayout holds an instance and reads from it directly. Key handling
 * will move here in step 3b; rendering will be extracted in step 3c.
 * Until 3b lands, AppLayout mutates the lines array and cursor position
 * directly through the exposed getters/setters.
 */
export class EditorState {
  #lines: string[] = [''];
  #cursorLine = 0;
  #cursorCol = 0;

  /**
   * The lines array. Direct mutation (index assignment, splice) is
   * intentional here — key handling still lives in AppLayout until step 3b.
   */
  public get lines(): string[] {
    return this.#lines;
  }

  public get cursorLine(): number {
    return this.#cursorLine;
  }

  public set cursorLine(n: number) {
    this.#cursorLine = n;
  }

  public get cursorCol(): number {
    return this.#cursorCol;
  }

  public set cursorCol(n: number) {
    this.#cursorCol = n;
  }

  /** Full text content — all lines joined by newline. */
  public get text(): string {
    return this.#lines.join('\n');
  }

  /** Reset to a single empty line with cursor at the origin. */
  public reset(): void {
    this.#lines = [''];
    this.#cursorLine = 0;
    this.#cursorCol = 0;
  }
}
