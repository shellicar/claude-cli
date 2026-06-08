import type { ClipboardImageResult } from '../src/clipboard.js';
import { AttachmentSource, type StatResult } from '../src/model/AttachmentSource.js';

type FakeOpts = {
  text?: string | null;
  path?: string | null;
  image?: ClipboardImageResult;
  stat?: StatResult | null;
};

/** A canned AttachmentSource for tests: no real clipboard or filesystem I/O. */
export class FakeAttachmentSource extends AttachmentSource {
  readonly #text: string | null;
  readonly #path: string | null;
  readonly #image: ClipboardImageResult;
  readonly #stat: StatResult | null;

  public constructor(opts: FakeOpts = {}) {
    super();
    this.#text = opts.text ?? null;
    this.#path = opts.path ?? null;
    this.#image = opts.image ?? { kind: 'empty' };
    this.#stat = opts.stat ?? null;
  }

  public async readText(): Promise<string | null> {
    return this.#text;
  }

  public async readPath(): Promise<string | null> {
    return this.#path;
  }

  public async readImage(): Promise<ClipboardImageResult> {
    return this.#image;
  }

  public async stat(): Promise<StatResult | null> {
    return this.#stat;
  }
}
