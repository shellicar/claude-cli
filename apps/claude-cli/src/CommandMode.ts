import type { KeyAction } from './input.js';

export type CommandAction = { type: 'none' } | { type: 'paste-image' } | { type: 'paste-text' } | { type: 'delete' } | { type: 'preview' } | { type: 'select-left' } | { type: 'select-right' } | { type: 'exit' } | { type: 'session-clear' } | { type: 'session-new' };

type CommandContext = 'root' | 'session';

export class CommandMode {
  private _active = false;
  private _previewActive = false;
  private _context: CommandContext = 'root';

  public get active(): boolean {
    return this._active;
  }

  public get previewActive(): boolean {
    return this._previewActive;
  }

  public get context(): CommandContext {
    return this._context;
  }

  public enter(): void {
    this._active = true;
  }

  public exit(): void {
    this._active = false;
    this._previewActive = false;
    this._context = 'root';
  }

  public togglePreview(): void {
    this._previewActive = !this._previewActive;
  }

  public toggle(): void {
    this._active = !this._active;
    if (!this._active) {
      this._context = 'root';
    }
  }

  public handleKey(key: KeyAction): CommandAction | null {
    if (!this._active) {
      return null;
    }

    if (this._context === 'session') {
      switch (key.type) {
        case 'char':
          if (key.value === 'c') {
            this._context = 'root';
            return { type: 'session-clear' };
          }
          if (key.value === 'n') {
            this._context = 'root';
            return { type: 'session-new' };
          }
          if (key.value === '/') {
            this._context = 'root';
            return { type: 'none' };
          }
          return { type: 'none' };
        default:
          return { type: 'none' };
      }
    }

    switch (key.type) {
      case 'char':
        switch (key.value) {
          case 'i':
            return { type: 'paste-image' };
          case 't':
            return { type: 'paste-text' };
          case 'd':
            return { type: 'delete' };
          case 'p':
            return { type: 'preview' };
          case 's':
            this._context = 'session';
            return { type: 'none' };
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
