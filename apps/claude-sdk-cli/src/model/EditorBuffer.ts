import EventEmitter from 'node:events';
import type { KeyAction } from '@shellicar/claude-core/input';
import { dependsOn } from '@shellicar/core-di';
import { createEditorContent, type EditorContent, type ReadonlyEditorContent } from './EditorContent.js';
import { handleKey, moveDownVisual, moveUpVisual } from './editorTransitions.js';
import { IGraphemeSegmenter } from './IGraphemeSegmenter.js';

type EditorBufferEvents = {
  change: [];
};

/**
 * The prompt editor: one mutable content and a change event, for the several
 * collaborators that read it.
 *
 * It holds no transition logic — that lives in editorTransitions.ts, which is
 * where the segmenter is a parameter. This is a cell and an emitter, so there
 * is nothing here for a dependency to be trapped inside.
 *
 * The editor's contract; register abstract→concrete and depend on the abstract (DI rule).
 */
export abstract class IEditorBuffer {
  public abstract on<K extends keyof EditorBufferEvents>(event: K, listener: (...args: EditorBufferEvents[K]) => void): void;
  public abstract off<K extends keyof EditorBufferEvents>(event: K, listener: (...args: EditorBufferEvents[K]) => void): void;
  public abstract get content(): ReadonlyEditorContent;
  public abstract reset(): void;
  public abstract handleKey(key: KeyAction): boolean;
  public abstract moveUpVisual(cols: number, prefixWidth: number): boolean;
  public abstract moveDownVisual(cols: number, prefixWidth: number): boolean;
}

export class EditorBuffer extends IEditorBuffer {
  @dependsOn(IGraphemeSegmenter) private readonly segmenter!: IGraphemeSegmenter;

  // readonly: the content object is this buffer's identity for its lifetime, so anything holding a
  // reference to it keeps seeing the live editor rather than a detached copy.
  readonly #content: EditorContent = createEditorContent();
  readonly #emitter = new EventEmitter<EditorBufferEvents>();

  public on<K extends keyof EditorBufferEvents>(event: K, listener: (...args: EditorBufferEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof EditorBufferEvents>(event: K, listener: (...args: EditorBufferEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  public get content(): ReadonlyEditorContent {
    return this.#content;
  }

  /**
   * Reset to a single empty line with cursor at the origin.
   *
   * Mutates in place, including the lines array, rather than assigning a fresh
   * content. Assigning would detach every reference already handed out, so a
   * holder would keep reading text the editor no longer has. Every other path
   * here mutates, and this one being the exception is what made it surprising.
   */
  public reset(): void {
    this.#content.lines.length = 1;
    this.#content.lines[0] = '';
    this.#content.cursorLine = 0;
    this.#content.cursorCol = 0;
    this.#emitter.emit('change');
  }

  public handleKey(key: KeyAction): boolean {
    const consumed = handleKey(this.segmenter, this.#content, key);
    if (consumed) {
      this.#emitter.emit('change');
    }
    return consumed;
  }

  public moveUpVisual(cols: number, prefixWidth: number): boolean {
    const consumed = moveUpVisual(this.segmenter, this.#content, cols, prefixWidth);
    this.#emitter.emit('change');
    return consumed;
  }

  public moveDownVisual(cols: number, prefixWidth: number): boolean {
    const consumed = moveDownVisual(this.segmenter, this.#content, cols, prefixWidth);
    this.#emitter.emit('change');
    return consumed;
  }
}
