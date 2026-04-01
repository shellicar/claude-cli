import stringWidth from 'string-width';

export class StatusLineBuilder {
  public output = '';

  /** Append text that is visible on screen. */
  public text(s: string): this {
    this.output += s;
    return this;
  }

  /** Append an emoji. */
  public emoji(s: string): this {
    this.output += s;
    return this;
  }

  /** Append an ANSI escape sequence (zero visible width). */
  public ansi(s: string): this {
    this.output += s;
    return this;
  }

  public screenLines(columns: number): number {
    return Math.max(1, Math.ceil(stringWidth(this.output) / columns));
  }
}
