import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { AppState } from './AppState.js';
import type { KeyAction } from './input.js';
import type { Terminal } from './terminal.js';

interface PendingPermission {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  label: string;
}

interface Waiter {
  input: Record<string, unknown>;
  resolve: (result: PermissionResult) => void;
}

function getTimeoutMs(toolName: string): number {
  switch (toolName) {
    case 'ExitPlanMode':
    case 'EnterPlanMode':
      return 120_000;
    default:
      return 30_000;
  }
}

export class PermissionManager {
  private queue: PendingPermission[] = [];
  private currentIndex = 0;
  private decisions = new Map<string, boolean>();
  private waiters = new Map<string, Waiter>();
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    private readonly term: Terminal,
    private readonly appState: AppState,
  ) {}

  public get hasActivePermissions(): boolean {
    return this.queue.length > 0;
  }

  /** Called from onMessage when a tool_use block arrives. */
  public enqueue(toolUseId: string, toolName: string, input: Record<string, unknown>): void {
    const desc = (input as Record<string, unknown>).description;
    const label = typeof desc === 'string' ? `${toolName}: ${desc}` : toolName;
    this.queue.push({ toolUseId, toolName, input, label });
    this.showCurrent();
  }

  /** Called from onMessage when a tool_result block arrives. Removes auto-approved items. */
  public handleResult(toolUseId: string): void {
    this.decisions.delete(toolUseId);
    this.removeAtIndex(this.queue.findIndex((p) => p.toolUseId === toolUseId));
  }

  /** Called from canUseTool. Returns pre-made decision or waits for user input. */
  public resolve(toolUseId: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<PermissionResult> {
    const decision = this.decisions.get(toolUseId);
    if (decision !== undefined) {
      this.decisions.delete(toolUseId);
      return Promise.resolve(this.toResult(decision, input));
    }

    return new Promise((resolve) => {
      this.waiters.set(toolUseId, { input, resolve });

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            if (this.waiters.has(toolUseId)) {
              this.waiters.delete(toolUseId);
              this.removeFromQueue(toolUseId);
              this.term.log('Permission cancelled by SDK');
              resolve({ behavior: 'deny', message: 'Cancelled' });
            }
          },
          { once: true },
        );
      }
    });
  }

  public handleKey(key: KeyAction): boolean {
    if (this.queue.length === 0) {
      return false;
    }

    if (key.type === 'char' && (key.value === 'y' || key.value === 'Y')) {
      this.resolveCurrentItem(true);
      return true;
    }
    if (key.type === 'char' && (key.value === 'n' || key.value === 'N')) {
      this.resolveCurrentItem(false);
      return true;
    }
    if (key.type === 'left') {
      if (this.currentIndex > 0) {
        this.currentIndex--;
        this.showCurrent();
      }
      return true;
    }
    if (key.type === 'right') {
      if (this.currentIndex < this.queue.length - 1) {
        this.currentIndex++;
        this.showCurrent();
      }
      return true;
    }

    // Swallow all other keys while permissions are pending — this is a modal state.
    return true;
  }

  public cancelAll(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.currentIndex = 0;

    for (const [toolUseId, waiter] of this.waiters) {
      waiter.resolve({ behavior: 'deny', message: 'Cancelled' });
      this.waiters.delete(toolUseId);
    }

    this.queue.length = 0;
    this.decisions.clear();
  }

  private resolveCurrentItem(allowed: boolean, reason?: string): void {
    clearInterval(this.timer);
    const current = this.queue[this.currentIndex];
    if (!current) {
      return;
    }

    const outcome = allowed ? 'allowed' : reason === 'timed out' ? 'timed out' : 'denied';
    this.term.info(`Allow? ${current.label}: ${outcome}`);

    // Check if the SDK is already waiting for this decision
    const waiter = this.waiters.get(current.toolUseId);
    if (waiter) {
      this.waiters.delete(current.toolUseId);
      waiter.resolve(this.toResult(allowed, waiter.input, reason));
    } else {
      // SDK hasn't called canUseTool yet — store the pre-made decision
      this.decisions.set(current.toolUseId, allowed);
    }

    this.removeAtIndex(this.currentIndex);
  }

  private removeFromQueue(toolUseId: string): void {
    this.removeAtIndex(this.queue.findIndex((p) => p.toolUseId === toolUseId));
  }

  /** Shared removal logic: splice queue, adjust currentIndex, reset or re-render. */
  private removeAtIndex(idx: number): void {
    if (idx < 0 || idx >= this.queue.length) {
      return;
    }
    this.queue.splice(idx, 1);

    if (idx < this.currentIndex) {
      this.currentIndex--;
    } else if (this.currentIndex >= this.queue.length && this.currentIndex > 0) {
      this.currentIndex = this.queue.length - 1;
    }

    if (this.queue.length === 0) {
      clearInterval(this.timer);
      this.currentIndex = 0;
      this.appState.thinking();
    } else {
      this.showCurrent();
    }
  }

  private showCurrent(): void {
    clearInterval(this.timer);
    const current = this.queue[this.currentIndex];
    if (!current) {
      return;
    }
    let remaining = Math.ceil(getTimeoutMs(current.toolName) / 1000);
    const prefix = this.queue.length > 1 ? `[${this.currentIndex + 1}/${this.queue.length}] ` : '';
    this.appState.prompting(`${prefix}Allow? ${current.label} (y/n) [${remaining}s]`);
    this.timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        this.resolveCurrentItem(false, 'timed out');
      } else {
        const prefix = this.queue.length > 1 ? `[${this.currentIndex + 1}/${this.queue.length}] ` : '';
        this.appState.prompting(`${prefix}Allow? ${current.label} (y/n) [${remaining}s]`);
      }
    }, 1000);
  }

  private toResult(allowed: boolean, input: Record<string, unknown>, reason?: string): PermissionResult {
    if (allowed) {
      return { behavior: 'allow', updatedInput: input } satisfies PermissionResult;
    }
    return { behavior: 'deny', message: reason === 'timed out' ? 'Permission timed out' : 'User denied' } satisfies PermissionResult;
  }
}
