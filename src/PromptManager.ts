import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { KeyAction } from './input.js';
import type { Terminal } from './terminal.js';

export interface AskQuestion {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

interface PendingPermission {
  toolName: string;
  input: Record<string, unknown>;
  resolve: (allowed: boolean) => void;
}

interface PendingQuestion {
  questions: AskQuestion[];
  input: Record<string, unknown>;
  currentIndex: number;
  answers: Record<string, string>;
  resolve: (result: PermissionResult) => void;
}

const PERMISSION_TIMEOUT_MS = 5 * 60_000;

export class PromptManager {
  private permissionQueue: PendingPermission[] = [];
  private permissionTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingQuestion: PendingQuestion | undefined;
  private questionOtherMode = false;
  private otherBuffer = '';

  constructor(private readonly term: Terminal) {}

  get hasActivePrompts(): boolean {
    return this.permissionQueue.length > 0 || this.pendingQuestion !== undefined;
  }

  requestPermission(toolName: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const entry: PendingPermission = {
        toolName,
        input,
        resolve: (allowed) => {
          if (allowed) {
            resolve({ behavior: 'allow', updatedInput: input });
          } else {
            resolve({ behavior: 'deny', message: 'User denied' });
          }
        },
      };

      if (signal) {
        signal.addEventListener('abort', () => {
          const idx = this.permissionQueue.indexOf(entry);
          if (idx !== -1) {
            this.permissionQueue.splice(idx, 1);
            if (idx === 0) {
              clearTimeout(this.permissionTimer);
              this.showNextPermission();
            }
            this.term.log('Permission cancelled by SDK');
            resolve({ behavior: 'deny', message: 'Cancelled' });
          }
        }, { once: true });
      }

      const wasEmpty = this.permissionQueue.length === 0;
      this.permissionQueue.push(entry);
      if (wasEmpty) {
        this.showNextPermission();
      }
    });
  }

  requestQuestion(questions: AskQuestion[], input: Record<string, unknown>, signal?: AbortSignal): Promise<PermissionResult> {
    return new Promise((resolve) => {
      this.pendingQuestion = {
        questions,
        input,
        currentIndex: 0,
        answers: {},
        resolve,
      };

      if (signal) {
        signal.addEventListener('abort', () => {
          if (this.pendingQuestion?.resolve === resolve) {
            this.pendingQuestion = undefined;
            this.questionOtherMode = false;
            this.otherBuffer = '';
            this.term.log('Question cancelled by SDK');
            resolve({ behavior: 'deny', message: 'Cancelled' });
          }
        }, { once: true });
      }

      this.showQuestion();
    });
  }

  handleKey(key: KeyAction): boolean {
    if (this.pendingQuestion) {
      if (this.questionOtherMode) {
        if (key.type === 'enter') {
          this.term.write('\n');
          if (this.otherBuffer.trim()) {
            this.term.log(`→ ${this.otherBuffer}`);
            this.questionOtherMode = false;
            this.advanceQuestion(this.otherBuffer);
            this.otherBuffer = '';
          } else {
            this.term.write('> ');
          }
        } else if (key.type === 'backspace') {
          if (this.otherBuffer.length > 0) {
            this.otherBuffer = this.otherBuffer.slice(0, -1);
            this.term.write('\b \b');
          }
        } else if (key.type === 'char') {
          this.otherBuffer += key.value;
          this.term.write(key.value);
        }
        return true;
      }
      if (key.type === 'char') {
        this.resolveQuestionKey(key.value);
      }
      return true;
    }

    if (this.permissionQueue.length > 0) {
      if (key.type === 'char' && (key.value === 'y' || key.value === 'Y')) {
        this.term.log('Allowed');
        this.resolvePermission(true);
        return true;
      }
      if (key.type === 'char' && (key.value === 'n' || key.value === 'N')) {
        this.term.log('Denied');
        this.resolvePermission(false);
        return true;
      }
      return true;
    }

    return false;
  }

  cancelAll(): void {
    clearTimeout(this.permissionTimer);
    this.permissionTimer = undefined;

    while (this.permissionQueue.length > 0) {
      const p = this.permissionQueue.shift();
      if (p) {
        p.resolve(false);
      }
    }

    if (this.pendingQuestion) {
      const pq = this.pendingQuestion;
      this.pendingQuestion = undefined;
      pq.resolve({ behavior: 'deny', message: 'Cancelled' });
    }

    this.questionOtherMode = false;
    this.otherBuffer = '';
  }

  private showNextPermission(): void {
    clearTimeout(this.permissionTimer);
    const next = this.permissionQueue[0];
    if (!next) return;
    this.term.log(`Permission: ${next.toolName}`, next.input);
    this.term.log('Allow? (y/n) [5m timeout]');
    this.permissionTimer = setTimeout(() => {
      this.term.log('Timed out, denied');
      this.resolvePermission(false);
    }, PERMISSION_TIMEOUT_MS);
  }

  private resolvePermission(allowed: boolean): void {
    clearTimeout(this.permissionTimer);
    const current = this.permissionQueue.shift();
    if (!current) return;
    current.resolve(allowed);
    this.showNextPermission();
  }

  private showQuestion(): void {
    if (!this.pendingQuestion) return;
    const q = this.pendingQuestion.questions[this.pendingQuestion.currentIndex];
    if (!q) return;
    this.term.write('\n');
    this.term.log(`\x1b[1m${q.question}\x1b[0m`);
    for (let i = 0; i < q.options.length; i++) {
      this.term.log(`  \x1b[36m${i + 1})\x1b[0m ${q.options[i].label} — ${q.options[i].description}`);
    }
    const otherNum = q.options.length + 1;
    this.term.log(`  \x1b[36m${otherNum})\x1b[0m Other — type a custom answer`);
    this.term.log(`Select [1-${otherNum}]:`);
  }

  private advanceQuestion(answer: string): void {
    if (!this.pendingQuestion) return;
    const q = this.pendingQuestion.questions[this.pendingQuestion.currentIndex];
    if (!q) return;
    this.pendingQuestion.answers[q.question] = answer;
    this.pendingQuestion.currentIndex++;
    if (this.pendingQuestion.currentIndex < this.pendingQuestion.questions.length) {
      this.showQuestion();
    } else {
      const pq = this.pendingQuestion;
      this.pendingQuestion = undefined;
      pq.resolve({ behavior: 'allow', updatedInput: { ...pq.input, answers: pq.answers } });
    }
  }

  private resolveQuestionKey(key: string): void {
    if (!this.pendingQuestion) return;
    const q = this.pendingQuestion.questions[this.pendingQuestion.currentIndex];
    if (!q) return;

    const otherNum = q.options.length + 1;
    const num = parseInt(key, 10);
    if (num >= 1 && num <= q.options.length) {
      const selected = q.options[num - 1];
      this.term.log(`→ ${selected.label}`);
      this.advanceQuestion(selected.label);
      return;
    }
    if (num === otherNum) {
      this.questionOtherMode = true;
      this.otherBuffer = '';
      this.term.log('Type your answer, then press Enter:');
      this.term.write('> ');
    }
  }
}
