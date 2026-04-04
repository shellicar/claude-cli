import { Interface, createInterface } from 'node:readline/promises';

export class ReadLine implements Disposable {

  async prompt<T extends string[]>(arg0: string, arg1: T): Promise<T[number]> {
    const options = arg1.map(x => x.toLocaleUpperCase());

    const message = `${arg0} (${options.join('/')})`;

    while (true) {
      const response = await this.rl.question(message);
      const match = response.toLocaleUpperCase();
      if (options.includes(match)) {
        return match as T[number];
      }
    }
  }
  rl: Interface;

  public constructor() {
    this.rl = createInterface({ input: process.stdin, output: process.stdout });
  }
  [Symbol.dispose](): void {
    this.rl[Symbol.dispose]();
  }

  public async question(prompt: string) {
    return await this.rl.question(prompt);
  }
}
