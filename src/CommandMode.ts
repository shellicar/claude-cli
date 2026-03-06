import type { KeyAction } from './input.js';

export type CommandAction = { type: 'none' } | { type: 'paste-image' } | { type: 'paste-text' } | { type: 'delete' } | { type: 'preview' } | { type: 'select-left' } | { type: 'select-right' } | { type: 'exit' };

export class CommandMode {
  private _active = false;
  private _previewActive = false;

  public get active(): boolean {
    return this._active;
  }

  public get previewActive(): boolean {
    return this._previewActive;
  }

  public enter(): void {
    this._active = true;
  }

  public exit(): void {
    this._active = false;
    this._previewActive = false;
  }

  public togglePreview(): void {
    this._previewActive = !this._previewActive;
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
          case 't':
            return { type: 'paste-text' };
          case 'd':
            return { type: 'delete' };
          case 'p':
            return { type: 'preview' };
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
