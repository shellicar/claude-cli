import type { KeyAction } from '@shellicar/claude-core/input';
import { dependsOn } from '@shellicar/core-di-lite';
import { ToolApprovalState } from '../model/ToolApprovalState.js';
import type { InputHandler } from './InputHandler.js';

/**
 * Tool-approval keys, claimed only while tools or approvals are pending. Y/N
 * resolves the next queued approval; space/left/right expand and navigate
 * pending tools. The flash timer is reconciled by Flasher off the change
 * event, not touched here.
 */
export class ApprovalHandler implements InputHandler {
  @dependsOn(ToolApprovalState) private readonly tools!: ToolApprovalState;

  public handleKey(key: KeyAction): boolean {
    if (this.tools.hasPendingApprovals && key.type === 'char') {
      const ch = key.value.toUpperCase();
      if (ch === 'Y' || ch === 'N') {
        this.tools.resolveNextApproval(ch === 'Y');
        return true;
      }
    }
    if (this.tools.hasPendingTools) {
      if (key.type === 'char' && key.value === ' ') {
        this.tools.toggleExpanded();
        return true;
      }
      if (key.type === 'left') {
        this.tools.selectPrev();
        return true;
      }
      if (key.type === 'right') {
        this.tools.selectNext();
        return true;
      }
    }
    return false;
  }
}
