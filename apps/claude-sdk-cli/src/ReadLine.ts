import readline from 'node:readline';

interface Key {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

export class ReadLine implements Disposable {
  public constructor() {
    readline.emitKeypressEvents(process.stdin);
  }

  public [Symbol.dispose](): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }

  #enter(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
  }

  #leave(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }

  public question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.#enter();
      process.stdout.write(prompt);
      const lines: string[] = [''];

      const cleanup = (): void => {
        process.stdin.removeListener('keypress', onKeypress);
        this.#leave();
      };

      const onKeypress = (ch: string | undefined, key: Key | undefined): void => {
        if (key?.ctrl && key?.name === 'c') {
          process.stdout.write('\n');
          process.exit(0);
        }
        // Ctrl+Enter: submit.
        // - ctrl flag path: standard raw mode terminals
        // - \x1b[27;5;13~: modifyOtherKeys format (iTerm2)
        // - \x1b[13;5u: CSI u format (VS Code integrated terminal, Kitty)
        const seq = key?.sequence ?? '';
        const isCtrlEnter = (key?.ctrl && key?.name === 'return') || seq === '\x1b[27;5;13~' || seq === '\x1b[13;5u';
        if (isCtrlEnter) {
          cleanup();
          process.stdout.write('\n');
          resolve(lines.join('\n'));
          return;
        }
        if (key?.name === 'return') {
          lines.push('');
          process.stdout.write('\n');
          return;
        }
        if (key?.name === 'backspace') {
          const current = lines[lines.length - 1];
          if (current.length > 0) {
            lines[lines.length - 1] = current.slice(0, -1);
            process.stdout.write('\b \b');
          }
          return;
        }
        if (ch && ch >= ' ') {
          lines[lines.length - 1] += ch;
          process.stdout.write(ch);
        }
      };

      process.stdin.on('keypress', onKeypress);
    });
  }

  public prompt<T extends string[]>(message: string, options: T): Promise<T[number]> {
    const upper = options.map((x) => x.toLocaleUpperCase());
    const display = `${message} (${upper.join('/')}) `;

    return new Promise((resolve) => {
      this.#enter();
      process.stdout.write(display);

      const cleanup = (): void => {
        process.stdin.removeListener('keypress', onKeypress);
        this.#leave();
      };

      const onKeypress = (ch: string | undefined, key: Key | undefined): void => {
        if (key?.ctrl && key?.name === 'c') {
          process.stdout.write('\n');
          process.exit(0);
        }
        const char = (ch ?? '').toLocaleUpperCase();
        if (upper.includes(char)) {
          cleanup();
          process.stdout.write(char + '\n');
          resolve(char as T[number]);
        }
      };

      process.stdin.on('keypress', onKeypress);
    });
  }
}
