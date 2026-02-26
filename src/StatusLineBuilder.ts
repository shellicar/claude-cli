export class StatusLineBuilder {
  public output = '';
  public visibleLength = 0;

  /** Append text that is visible on screen (counts toward line width). */
  public text(s: string): this {
    this.output += s;
    this.visibleLength += s.length;
    return this;
  }

  /** Append an emoji (2 terminal columns wide). */
  public emoji(s: string): this {
    this.output += s;
    this.visibleLength += 2;
    return this;
  }

  /** Append an ANSI escape sequence (zero visible width). */
  public ansi(s: string): this {
    this.output += s;
    return this;
  }

  public screenLines(columns: number): number {
    return Math.max(1, Math.ceil(this.visibleLength / columns));
  }
}
