import { type KeyAction, setupKeypressHandler } from '@shellicar/claude-core/input';
import type { AppLayout } from './AppLayout.js';

export class ReadLine implements Disposable {
  readonly #cleanup: () => void;
  #layout: AppLayout | null = null;

  public constructor() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    this.#cleanup = setupKeypressHandler((key) => this.#handleKey(key));
  }

  public [Symbol.dispose](): void {
    this.#cleanup();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }

  public setLayout(layout: AppLayout): void {
    this.#layout = layout;
  }

  #handleKey(key: KeyAction): void {
    if (this.#layout !== null) {
      this.#layout.handleKey(key);
      return;
    }
    if (key.type === 'ctrl+c') {
      process.exit(0);
    }
  }
}
