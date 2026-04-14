/** A greeting service. */
export class Greeter {
  /** The greeting prefix. */
  public readonly prefix: string;

  public constructor(prefix: string) {
    this.prefix = prefix;
  }

  /** Returns a greeting for the given name. */
  public greet(name: string): string {
    return `${this.prefix}, ${name}!`;
  }
}
