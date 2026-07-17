import EventEmitter from 'node:events';

type ToolApprovalStateEvents = {
  change: [];
};

export type PendingTool = {
  requestId: string;
  name: string;
  input: Record<string, unknown>;
};

/**
 * Pure state for the tool approval UI: pending tools, selection, expand/collapse,
 * and the promise queue that connects the async approval flow to keyboard input.
 *
 * No rendering, no I/O. The approval queue holds live resolver functions keyed by
 * requestId — addTool, removeTool, requestApproval, resolveApproval and
 * resolveSelected must all live here so the queue never splits across two objects.
 */
export class ToolApprovalState {
  #pendingTools: PendingTool[] = [];
  #selectedTool = 0;
  #toolExpanded = false;
  #pendingApprovals = new Map<string, (approved: boolean) => void>();
  #flashPhase = false;
  readonly #emitter = new EventEmitter<ToolApprovalStateEvents>();

  public on<K extends keyof ToolApprovalStateEvents>(event: K, listener: (...args: ToolApprovalStateEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof ToolApprovalStateEvents>(event: K, listener: (...args: ToolApprovalStateEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  public get pendingTools(): ReadonlyArray<PendingTool> {
    return this.#pendingTools;
  }

  public get selectedTool(): number {
    return this.#selectedTool;
  }

  public get toolExpanded(): boolean {
    return this.#toolExpanded;
  }

  public get hasPendingTools(): boolean {
    return this.#pendingTools.length > 0;
  }

  public get hasPendingApprovals(): boolean {
    return this.#pendingApprovals.size > 0;
  }

  public get flashPhase(): boolean {
    return this.#flashPhase;
  }

  /** Add a tool to the pending list. First tool resets selection to 0. */
  public addTool(tool: PendingTool): void {
    this.#pendingTools.push(tool);
    if (this.#pendingTools.length === 1) {
      this.#selectedTool = 0;
    }
    this.#emitter.emit('change');
  }

  /** Remove a tool by requestId and clamp selection to the new length. */
  public removeTool(requestId: string): boolean {
    const idx = this.#pendingTools.findIndex((t) => t.requestId === requestId);
    if (idx < 0) {
      return false;
    }
    this.#pendingTools.splice(idx, 1);
    this.#selectedTool = Math.min(this.#selectedTool, Math.max(0, this.#pendingTools.length - 1));
    this.#emitter.emit('change');
    return true;
  }

  /** Clear all pending tools (called when streaming completes). */
  public clearTools(): void {
    this.#pendingTools = [];
    this.#emitter.emit('change');
  }

  /**
   * Queue an approval request keyed by requestId (the tool_use id). Returns a
   * promise that resolves when this exact ask is settled — by a keypress on the
   * selected tool (resolveSelected) or by the owning handler draining its own id
   * (resolveApproval). Keying by id keeps a batch's approvals independent:
   * answering one never settles another.
   */
  public requestApproval(requestId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.#pendingApprovals.set(requestId, resolve);
      this.#emitter.emit('change');
    });
  }

  /**
   * Resolve the approval for a specific requestId. Returns true if one was
   * pending for that id, false otherwise (already settled or never queued).
   */
  public resolveApproval(requestId: string, approved: boolean): boolean {
    const resolve = this.#pendingApprovals.get(requestId);
    if (!resolve) {
      return false;
    }
    this.#pendingApprovals.delete(requestId);
    resolve(approved);
    this.#emitter.emit('change');
    return true;
  }

  /**
   * Resolve the approval for the currently selected tool — the one the user is
   * looking at when they press Y/N. Returns true if that tool had a pending
   * approval, false otherwise.
   */
  public resolveSelected(approved: boolean): boolean {
    const tool = this.#pendingTools[this.#selectedTool];
    if (!tool) {
      return false;
    }
    return this.resolveApproval(tool.requestId, approved);
  }

  /** Toggle the flash phase for the pending approval indicator. Called by the flash timer. */
  public toggleFlash(): void {
    this.#flashPhase = !this.#flashPhase;
    this.#emitter.emit('change');
  }

  /** Toggle the expanded/collapsed state of the selected tool's input. */
  public toggleExpanded(): void {
    this.#toolExpanded = !this.#toolExpanded;
    this.#emitter.emit('change');
  }

  /** Select the previous tool. */
  public selectPrev(): void {
    this.#selectedTool = Math.max(0, this.#selectedTool - 1);
    this.#emitter.emit('change');
  }

  /** Select the next tool. */
  public selectNext(): void {
    this.#selectedTool = Math.min(this.#pendingTools.length - 1, this.#selectedTool + 1);
    this.#emitter.emit('change');
  }

  /** Collapse the expanded view (called when returning to editor mode). */
  public resetExpanded(): void {
    this.#toolExpanded = false;
    this.#emitter.emit('change');
  }
}
