/** A say's attachment reference block, as it arrived on the wire (conversation-spec, say attachments). */
export type AttachmentReferenceBlock = {
  type: string;
  source: { type: string; id: string; bucket?: string; mediaType?: string; size?: number };
};

/** The ledger's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IWireAttachmentLedger {
  public abstract put(queryId: string, blocks: readonly AttachmentReferenceBlock[]): void;
  public abstract take(queryId: string): readonly AttachmentReferenceBlock[] | null;
}

/**
 * Holds an accepted say's reference blocks until its user message commits, so the change stream can
 * carry the blocks verbatim while the model-facing request carries the inlined bytes — the record
 * stays light and wire-legal (conversation-spec: the committed message carries the reference block
 * verbatim, never the bytes).
 */
export class WireAttachmentLedger extends IWireAttachmentLedger {
  readonly #blocks = new Map<string, readonly AttachmentReferenceBlock[]>();

  public put(queryId: string, blocks: readonly AttachmentReferenceBlock[]): void {
    this.#blocks.set(queryId, blocks);
  }

  public take(queryId: string): readonly AttachmentReferenceBlock[] | null {
    const blocks = this.#blocks.get(queryId) ?? null;
    this.#blocks.delete(queryId);
    return blocks;
  }
}
