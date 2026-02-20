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
  private questionOtherMode = false;
  private otherBuffer = '';

  public constructor(
    private readonly term: Terminal,
    private readonly appState: AppState,
  ) {}

  public get hasActivePrompts(): boolean {
    return this.pendingQuestion !== undefined;
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
              this.questionOtherMode = false;
              this.otherBuffer = '';
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

  public handleKey(key: KeyAction): boolean {
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

    return false;
  }

  public cancelAll(): void {
    if (this.pendingQuestion) {
      const pq = this.pendingQuestion;
      this.pendingQuestion = undefined;
      pq.resolve({ behavior: 'deny', message: 'Cancelled' });
    }

    this.questionOtherMode = false;
    this.otherBuffer = '';
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
      this.questionOtherMode = true;
      this.otherBuffer = '';
      this.term.log('Type your answer, then press Enter:');
      this.term.write('> ');
    }
  }
}
