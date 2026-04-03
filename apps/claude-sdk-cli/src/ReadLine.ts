import { Interface, createInterface } from 'node:readline/promises';

export class ReadLine implements Disposable {
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
