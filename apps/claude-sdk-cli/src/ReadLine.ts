import { type KeyAction, setupKeypressHandler } from '@shellicar/claude-core/input';

export class ReadLine implements Disposable {
  readonly #cleanup: () => void;
  #activeHandler: ((key: KeyAction) => void) | null = null;
  public onCancel: (() => void) | undefined;

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

  #handleKey(key: KeyAction): void {
    if (key.type === 'ctrl+c') {
      process.stdout.write('\n');
      process.exit(0);
    }
    if (key.type === 'escape') {
      this.onCancel?.();
      return;
    }
    this.#activeHandler?.(key);
  }

  public question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      process.stdout.write(prompt);
      const lines: string[] = [''];

      this.#activeHandler = (key: KeyAction) => {
        if (key.type === 'ctrl+enter') {
          this.#activeHandler = null;
          process.stdout.write('\n');
          resolve(lines.join('\n'));
          return;
        }
        if (key.type === 'enter') {
          lines.push('');
          process.stdout.write('\n');
          return;
        }
        if (key.type === 'backspace') {
          const current = lines[lines.length - 1];
          if (current.length > 0) {
            lines[lines.length - 1] = current.slice(0, -1);
            process.stdout.write('\b \b');
          }
          return;
        }
        if (key.type === 'char') {
          lines[lines.length - 1] += key.value;
          process.stdout.write(key.value);
        }
      };
    });
  }

  public prompt<T extends string[]>(message: string, options: T): Promise<T[number]> {
    const upper = options.map((x) => x.toLocaleUpperCase());
    const display = `${message} (${upper.join('/')}) `;

    return new Promise((resolve) => {
      process.stdout.write(display);

      this.#activeHandler = (key: KeyAction) => {
        if (key.type !== 'char') return;
        const char = key.value.toLocaleUpperCase();
        if (upper.includes(char)) {
          this.#activeHandler = null;
          process.stdout.write(char + '\n');
          resolve(char as T[number]);
        }
      };
    });
  }
}
