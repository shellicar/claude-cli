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
  resolve: (result: PermissionResult) => void;
}

export class PromptManager {
  private pendingQuestion: PendingQuestion | undefined;
  private _isOtherMode = false;

  public constructor(
    private readonly term: Terminal,
    private readonly appState: AppState,
  ) {}

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
        resolve,
      };

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            if (this.pendingQuestion?.resolve === resolve) {
              this.pendingQuestion = undefined;
              this._isOtherMode = false;
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
      if (key.type === 'char') {
        this.resolveQuestionKey(key.value);
      }
      return true;
    }

    return false;
  }

  public cancelAll(): void {
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
    this.appState.asking(`${q.header}: Select [1-${q.options.length + 1}]`);
    this.term.log(`\x1b[1m${q.question}\x1b[0m`);
    for (let i = 0; i < q.options.length; i++) {
      this.term.log(`  \x1b[36m${i + 1})\x1b[0m ${q.options[i].label} — ${q.options[i].description}`);
    }
    const otherNum = q.options.length + 1;
    this.term.log(`  \x1b[36m${otherNum})\x1b[0m Other — type a custom answer`);
    this.term.log(`Select [1-${otherNum}]:`);
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
    if (this.pendingQuestion.currentIndex < this.pendingQuestion.questions.length) {
      this.showQuestion();
    } else {
      const pq = this.pendingQuestion;
      this.pendingQuestion = undefined;
      this.appState.thinking();
      pq.resolve({ behavior: 'allow', updatedInput: { ...pq.input, answers: pq.answers } });
    }
  }

  private resolveQuestionKey(key: string): void {
    if (!this.pendingQuestion) {
      return;
    }
    const q = this.pendingQuestion.questions[this.pendingQuestion.currentIndex];
    if (!q) {
      return;
    }

    const otherNum = q.options.length + 1;
    const num = parseInt(key, 10);
    if (num >= 1 && num <= q.options.length) {
      const selected = q.options[num - 1];
      this.term.log(`→ ${selected.label}`);
      this.advanceQuestion(selected.label);
      return;
    }
    if (num === otherNum) {
      this._isOtherMode = true;
      this.appState.asking('Type your answer, Ctrl+Enter to submit, Escape to cancel');
    }
  }
}
