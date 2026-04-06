export type PendingTool = {
  requestId: string;
  name: string;
  input: Record<string, unknown>;
};

/**
 * Pure state for the tool approval UI: pending tools, selection, expand/collapse,
 * and the promise queue that connects the async approval flow to keyboard input.
 *
 * No rendering, no I/O. The approval queue holds live resolver functions — addTool,
 * removeTool, requestApproval, and resolveNextApproval must all live here so the
 * queue never splits across two objects.
 */
export class ToolApprovalState {
  #pendingTools: PendingTool[] = [];
  #selectedTool = 0;
  #toolExpanded = false;
  #pendingApprovals: Array<(approved: boolean) => void> = [];

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
    return this.#pendingApprovals.length > 0;
  }

  /** Add a tool to the pending list. First tool resets selection to 0. */
  public addTool(tool: PendingTool): void {
    this.#pendingTools.push(tool);
    if (this.#pendingTools.length === 1) {
      this.#selectedTool = 0;
    }
  }

  /** Remove a tool by requestId and clamp selection to the new length. */
  public removeTool(requestId: string): boolean {
    const idx = this.#pendingTools.findIndex((t) => t.requestId === requestId);
    if (idx < 0) {
      return false;
    }
    this.#pendingTools.splice(idx, 1);
    this.#selectedTool = Math.min(this.#selectedTool, Math.max(0, this.#pendingTools.length - 1));
    return true;
  }

  /** Clear all pending tools (called when streaming completes). */
  public clearTools(): void {
    this.#pendingTools = [];
  }

  /**
   * Queue an approval request. Returns a promise that resolves when the user
   * presses Y or N (via resolveNextApproval). Multiple calls queue in FIFO order.
   */
  public requestApproval(): Promise<boolean> {
    return new Promise((resolve) => {
      this.#pendingApprovals.push(resolve);
    });
  }

  /**
   * Resolve the next queued approval with the given answer.
   * Returns true if there was a pending approval, false if the queue was empty.
   */
  public resolveNextApproval(approved: boolean): boolean {
    const resolve = this.#pendingApprovals.shift();
    if (!resolve) {
      return false;
    }
    resolve(approved);
    return true;
  }

  /** Toggle the expanded/collapsed state of the selected tool's input. */
  public toggleExpanded(): void {
    this.#toolExpanded = !this.#toolExpanded;
  }

  /** Select the previous tool, collapsing any expansion. */
  public selectPrev(): void {
    this.#selectedTool = Math.max(0, this.#selectedTool - 1);
    this.#toolExpanded = false;
  }

  /** Select the next tool, collapsing any expansion. */
  public selectNext(): void {
    this.#selectedTool = Math.min(this.#pendingTools.length - 1, this.#selectedTool + 1);
    this.#toolExpanded = false;
  }

  /** Collapse the expanded view (called when returning to editor mode). */
  public resetExpanded(): void {
    this.#toolExpanded = false;
  }
}
