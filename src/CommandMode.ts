import type { KeyAction } from './input.js';

export type CommandAction = { type: 'none' } | { type: 'paste-image' } | { type: 'delete-image' } | { type: 'select-left' } | { type: 'select-right' } | { type: 'exit' };

export class CommandMode {
  private _active = false;

  public get active(): boolean {
    return this._active;
  }

  public enter(): void {
    this._active = true;
  }

  public exit(): void {
    this._active = false;
  }

  public toggle(): void {
    this._active = !this._active;
  }

  public handleKey(key: KeyAction): CommandAction | null {
    if (!this._active) {
      return null;
    }

    switch (key.type) {
      case 'char':
        switch (key.value) {
          case 'i':
            return { type: 'paste-image' };
          case 'd':
            return { type: 'delete-image' };
          default:
            return { type: 'none' };
        }
      case 'left':
        return { type: 'select-left' };
      case 'right':
        return { type: 'select-right' };
      case 'escape':
        return { type: 'exit' };
      default:
        return { type: 'none' };
    }
  }
}
