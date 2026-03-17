import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { AppState } from './AppState.js';
import type { KeyAction } from './input.js';
import type { Terminal } from './terminal.js';

export interface AskQuestion {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

interface PendingQuestion {
  questions: AskQuestion[];
  input: Record<string, unknown>;
  currentIndex: number;
  answers: Record<string, string>;
  selectedIndices: Set<number>;
  resolve: (result: PermissionResult) => void;
}

export class PromptManager {
  private pendingQuestion: PendingQuestion | undefined;
  private _isOtherMode = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    private readonly term: Terminal,
    private readonly appState: AppState,
    private questionTimeoutMs: number | null,
  ) {}

  public updateConfig(questionTimeoutMs: number | null): void {
    this.questionTimeoutMs = questionTimeoutMs;
  }

  public get hasActivePrompts(): boolean {
    return this.pendingQuestion !== undefined;
  }

  public get isOtherMode(): boolean {
    return this._isOtherMode;
  }

  public requestQuestion(questions: AskQuestion[], input: Record<string, unknown>, signal?: AbortSignal): Promise<PermissionResult> {
    return new Promise((resolve) => {
      this.pendingQuestion = {
        questions,
        input,
        currentIndex: 0,
        answers: {},
        selectedIndices: new Set(),
        resolve,
      };

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            if (this.pendingQuestion?.resolve === resolve) {
              this.pendingQuestion = undefined;
              this._isOtherMode = false;
              this.term.clearQuestionLines();
              this.appState.thinking();
              this.term.log('Question cancelled by SDK');
              resolve({ behavior: 'deny', message: 'Cancelled' });
            }
          },
          { once: true },
        );
      }

      this.showQuestion();
    });
  }

  /** Submit the "Other" answer from the editor. Called by ClaudeCli. */
  public submitOther(answer: string): void {
    this._isOtherMode = false;
    this.term.log(`→ ${answer}`);
    this.advanceQuestion(answer);
  }

  /** Cancel "Other" mode without submitting. Called by ClaudeCli on Escape. */
  public cancelOther(): void {
    if (this._isOtherMode) {
      this._isOtherMode = false;
      if (this.pendingQuestion) {
        const q = this.pendingQuestion.questions[this.pendingQuestion.currentIndex];
        if (q) {
          this.appState.asking(`${q.header}: Select [1-${q.options.length + 1}]`);
        }
      }
    }
  }

  public handleKey(key: KeyAction): boolean {
    if (this.pendingQuestion) {
      // In "Other" mode, let all keys fall through to the editor in ClaudeCli.
      // ClaudeCli handles ctrl+enter (submit) and escape (cancel).
      if (this._isOtherMode) {
        return false;
      }
      const q = this.pendingQuestion.questions[this.pendingQuestion.currentIndex];
      if (q?.multiSelect && key.type === 'enter') {
        const selected = [...this.pendingQuestion.selectedIndices].sort((a, b) => a - b).map((i) => q.options[i].label);
        for (const line of this.renderMultiSelectOptions(q)) {
          this.term.info(line);
        }
        this.term.clearQuestionLines();
        this.term.log(`→ ${selected.join(', ')}`);
        this.advanceQuestion(selected.join(', '));
        return true;
      }
      if (key.type === 'char') {
        this.resolveQuestionKey(key.value);
      }
      return true;
    }

    return false;
  }

  public cancelAll(): void {
    this.stopTimer();
    this.term.clearQuestionLines();
    if (this.pendingQuestion) {
      const pq = this.pendingQuestion;
      this.pendingQuestion = undefined;
      pq.resolve({ behavior: 'deny', message: 'Cancelled' });
    }

    this._isOtherMode = false;
  }

  private showQuestion(): void {
    if (!this.pendingQuestion) {
      return;
    }
    const q = this.pendingQuestion.questions[this.pendingQuestion.currentIndex];
    if (!q) {
      return;
    }

    this.stopTimer();
    const isMulti = q.multiSelect;
    const selectLabel = isMulti ? q.header : `${q.header}: Select [1-${q.options.length + 1}]`;

    if (this.questionTimeoutMs !== null) {
      let remaining = Math.ceil(this.questionTimeoutMs / 1000);
      this.appState.asking(`${selectLabel} [${remaining}s]`, remaining);
      this.timer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          this.stopTimer();
          this.term.clearQuestionLines();
          this.term.log('Question timed out');
          const pq = this.pendingQuestion;
          if (pq) {
            this.pendingQuestion = undefined;
            this._isOtherMode = false;
            this.appState.thinking();
            pq.resolve({ behavior: 'deny', message: 'Question timed out' });
          }
        } else {
          this.appState.asking(`${selectLabel} [${remaining}s]`, remaining);
        }
      }, 1000);
    } else {
      this.appState.asking(selectLabel);
    }

    this.term.log(`\x1b[1m${q.question}\x1b[0m`);
    if (isMulti) {
      this.term.setQuestionLines(this.renderMultiSelectOptions(q));
    } else {
      for (let i = 0; i < q.options.length; i++) {
        this.term.log(`  \x1b[36m${i + 1})\x1b[0m ${q.options[i].label} — ${q.options[i].description}`);
      }
      const otherNum = q.options.length + 1;
      this.term.log(`  \x1b[36m${otherNum})\x1b[0m Other — type a custom answer`);
      this.term.log(`Select [1-${otherNum}]:`);
    }
  }

  private advanceQuestion(answer: string): void {
    if (!this.pendingQuestion) {
      return;
    }
    const q = this.pendingQuestion.questions[this.pendingQuestion.currentIndex];
    if (!q) {
      return;
    }
    this.pendingQuestion.answers[q.question] = answer;
    this.pendingQuestion.currentIndex++;
    this.pendingQuestion.selectedIndices = new Set();
    if (this.pendingQuestion.currentIndex < this.pendingQuestion.questions.length) {
      this.showQuestion();
    } else {
      this.stopTimer();
      const pq = this.pendingQuestion;
      this.pendingQuestion = undefined;
      this.appState.thinking();
      pq.resolve({ behavior: 'allow', updatedInput: { ...pq.input, answers: pq.answers } });
    }
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private renderMultiSelectOptions(q: AskQuestion): string[] {
    const lines: string[] = [];
    lines.push(`Select [1-${q.options.length}], Enter to confirm:`);
    for (let i = 0; i < q.options.length; i++) {
      const selected = this.pendingQuestion?.selectedIndices.has(i);
      const marker = selected ? '\x1b[32m[x]\x1b[0m' : '[ ]';
      lines.push(`  \x1b[36m${i + 1})\x1b[0m ${marker} ${q.options[i].label} — ${q.options[i].description}`);
    }
    return lines;
  }

  private resolveQuestionKey(key: string): void {
    if (!this.pendingQuestion) {
      return;
    }
    const q = this.pendingQuestion.questions[this.pendingQuestion.currentIndex];
    if (!q) {
      return;
    }

    const num = parseInt(key, 10);

    if (q.multiSelect) {
      if (num >= 1 && num <= q.options.length) {
        const idx = num - 1;
        if (this.pendingQuestion.selectedIndices.has(idx)) {
          this.pendingQuestion.selectedIndices.delete(idx);
        } else {
          this.pendingQuestion.selectedIndices.add(idx);
        }
        this.stopTimer();
        const count = this.pendingQuestion.selectedIndices.size;
        this.appState.asking(`${q.header}: ${count} selected`);
        this.term.setQuestionLines(this.renderMultiSelectOptions(q));
      }
      return;
    }

    const otherNum = q.options.length + 1;
    if (num >= 1 && num <= q.options.length) {
      const selected = q.options[num - 1];
      this.term.log(`→ ${selected.label}`);
      this.advanceQuestion(selected.label);
      return;
    }
    if (num === otherNum) {
      this.stopTimer();
      this._isOtherMode = true;
      this.appState.asking('Type your answer, Ctrl+Enter to submit, Escape to cancel');
    }
  }
}
