import {
  createEditor,
  getText,
  clear,
  insertChar,
  insertNewline,
  backspace,
  deleteChar,
  deleteWord,
  deleteWordBackward,
  moveLeft,
  moveRight,
  moveUp,
  moveDown,
  moveHome,
  moveEnd,
  moveBufferStart,
  moveBufferEnd,
  moveWordLeft,
  moveWordRight,
  type EditorState,
} from './editor.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initAudit, writeAuditEntry } from './audit.js';
import { getConfig, isInsideCwd, isSafeBashCommand } from './config.js';
import { formatDiff } from './diff.js';
import { parseKey } from './input.js';
import { render, createRenderState, type RenderState } from './renderer.js';
import { QuerySession } from './session.js';
import { Terminal } from './terminal.js';

const SESSION_FILE = resolve(process.cwd(), '.claude-cli-session');

function loadSession(log: (msg: string) => void): string | undefined {
  if (!existsSync(SESSION_FILE)) {
    log(`No session file found at ${SESSION_FILE}`);
    return undefined;
  }
  try {
    const content = readFileSync(SESSION_FILE, 'utf8').trim();
    if (!content) {
      log('Session file exists but is empty');
      return undefined;
    }
    log(`Found saved session: ${content}`);
    return content;
  } catch (err) {
    log(`Failed to read session file: ${err}`);
    return undefined;
  }
}

function saveSession(id: string): void {
  writeFileSync(SESSION_FILE, id);
}

const term = new Terminal();
const session = new QuerySession();
let editor: EditorState = createEditor();
let renderState: RenderState = createRenderState();
interface PendingPermission {
  toolName: string;
  input: Record<string, unknown>;
  resolve: (allowed: boolean) => void;
}
const permissionQueue: PendingPermission[] = [];
let permissionTimer: ReturnType<typeof setTimeout> | undefined;
const PERMISSION_TIMEOUT_MS = 5 * 60_000;

interface AskQuestion {
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
  resolve: (updatedInput: Record<string, unknown>) => void;
}
let pendingQuestion: PendingQuestion | undefined;
let questionOtherMode = false;
let otherBuffer = '';

function showQuestion(): void {
  if (!pendingQuestion) return;
  const q = pendingQuestion.questions[pendingQuestion.currentIndex];
  if (!q) return;
  term.write('\n');
  term.log(`\x1b[1m${q.question}\x1b[0m`);
  for (let i = 0; i < q.options.length; i++) {
    term.log(`  \x1b[36m${i + 1})\x1b[0m ${q.options[i].label} — ${q.options[i].description}`);
  }
  const otherNum = q.options.length + 1;
  term.log(`  \x1b[36m${otherNum})\x1b[0m Other — type a custom answer`);
  term.log(`Select [1-${otherNum}]:`);
}

function advanceQuestion(answer: string): void {
  if (!pendingQuestion) return;
  const q = pendingQuestion.questions[pendingQuestion.currentIndex];
  if (!q) return;
  pendingQuestion.answers[q.question] = answer;
  pendingQuestion.currentIndex++;
  if (pendingQuestion.currentIndex < pendingQuestion.questions.length) {
    showQuestion();
  } else {
    const pq = pendingQuestion;
    pendingQuestion = undefined;
    pq.resolve({ ...pq.input, answers: pq.answers });
  }
}

function resolveQuestionKey(key: string): boolean {
  if (!pendingQuestion) return false;
  const q = pendingQuestion.questions[pendingQuestion.currentIndex];
  if (!q) return false;

  // In "other" text input mode
  if (pendingQuestion.currentIndex < 0) return false; // guard

  const otherNum = q.options.length + 1;
  const num = parseInt(key, 10);
  if (num >= 1 && num <= q.options.length) {
    const selected = q.options[num - 1];
    term.log(`→ ${selected.label}`);
    advanceQuestion(selected.label);
    return true;
  }
  if (num === otherNum) {
    questionOtherMode = true;
    otherBuffer = '';
    term.log('Type your answer, then press Enter:');
    term.write('> ');
    return true;
  }
  return true; // consume but ignore invalid keys
}

function showNextPermission(): void {
  clearTimeout(permissionTimer);
  const next = permissionQueue[0];
  if (!next) return;
  term.log(`Permission: ${next.toolName}`, next.input);
  term.log('Allow? (y/n) [5m timeout]');
  permissionTimer = setTimeout(() => {
    term.log('Timed out, denied');
    resolvePermission(false);
  }, PERMISSION_TIMEOUT_MS);
}

function resolvePermission(allowed: boolean): void {
  clearTimeout(permissionTimer);
  const current = permissionQueue.shift();
  if (!current) return;
  current.resolve(allowed);
  showNextPermission();
}

session.canUseTool = (toolName, input) => {
  const config = getConfig();
  const cwd = process.cwd();

  // // Auto-approve read-only tools
  // if (config.autoApproveReads && isReadOnlyTool(toolName)) {
  //   term.log(`auto-approved: ${toolName}`);
  //   return { behavior: 'allow', updatedInput: input };
  // }

  const allow = (updatedInput: Record<string, unknown>) =>
    Promise.resolve({ behavior: 'allow' as const, updatedInput });

  // Auto-approve safe Bash commands
  if (config.autoApproveSafeBash && toolName === 'Bash') {
    const command = (input as { command?: string }).command;
    if (command && isSafeBashCommand(command)) {
      term.log(`auto-approved: Bash(${command})`);
      return allow(input);
    }
  }

  // AskUserQuestion — render and capture selection
  if (toolName === 'AskUserQuestion') {
    const questions = (input as { questions?: AskQuestion[] }).questions;
    if (questions && questions.length > 0) {
      return new Promise((resolve) => {
        pendingQuestion = {
          questions,
          input,
          currentIndex: 0,
          answers: {},
          resolve: (updatedInput) => {
            resolve({ behavior: 'allow', updatedInput });
          },
        };
        showQuestion();
      });
    }
  }

  // Auto-approve edits inside cwd
  if (config.autoApproveEdits && (toolName === 'Edit' || toolName === 'Write')) {
    const filePath = (input as { file_path?: string }).file_path;
    if (filePath && isInsideCwd(filePath, cwd)) {
      term.log(`auto-approved: ${toolName} ${filePath}`);
      return allow(input);
    }
  }

  return new Promise((resolve) => {
    const wasEmpty = permissionQueue.length === 0;
    permissionQueue.push({
      toolName,
      input,
      resolve: (allowed) => {
        if (allowed) {
          resolve({ behavior: 'allow', updatedInput: input });
        } else {
          resolve({ behavior: 'deny', message: 'User denied' });
        }
      },
    });
    if (wasEmpty) {
      showNextPermission();
    }
  });
};

function handleCommand(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '/quit' || trimmed === '/exit') {
    cleanup();
    term.info('Goodbye.');
    process.exit(0);
  }
  if (trimmed === '/session' || trimmed.startsWith('/session ')) {
    const arg = trimmed.slice('/session'.length).trim();
    if (arg) {
      session.setSessionId(arg);
      term.info(`Switched to session: ${arg}`);
    } else {
      term.info(`Session: ${session.currentSessionId ?? 'none'}`);
    }
    return true;
  }
  if (trimmed.startsWith('/compact-at ')) {
    const uuid = trimmed.slice('/compact-at '.length).trim();
    if (!uuid) {
      term.info('Usage: /compact-at <message-uuid>');
      return true;
    }
    term.info(`Compacting at: ${uuid}`);
    session.setResumeAt(uuid);
    submit('/compact');
    return true;
  }
  return false;
}

async function submit(override?: string): Promise<void> {
  const text = override ?? getText(editor);
  if (!text.trim()) return;

  editor = clear(editor);
  renderState = createRenderState();
  term.write('\n');
  term.log(`> ${text}`);

  if (handleCommand(text)) {
    redraw();
    return;
  }

  const startTime = Date.now();
  term.log('Sending query...');
  const timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    term.status(`Waiting for ${seconds}s...`);
  }, 500);

  let pendingStatus = false;
  const logEvent = (msg: string, ...args: any[]) => {
    if (pendingStatus) {
      term.write('\n');
      pendingStatus = false;
    }
    term.log(msg, ...args);
  };

  session.on('message', (msg) => {
    clearInterval(timer);
    writeAuditEntry(msg);

    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          logEvent(`session: ${msg.session_id} model: ${msg.model}`);
        } else {
          logEvent(`system: ${msg.subtype}`);
        }
        break;
      case 'assistant': {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            logEvent(`assistant: ${block.text}`);
          } else if (block.type === 'tool_use') {
            if (block.name === 'Edit') {
              const input = block.input as { file_path?: string; old_string?: string; new_string?: string };
              logEvent(`tool_use: Edit ${input.file_path ?? 'unknown'}`);
              if (input.old_string && input.new_string) {
                term.write(formatDiff(input.file_path ?? 'unknown', input.old_string, input.new_string));
                term.write('\n');
              }
            } else {
              logEvent(`tool_use: ${block.name}`, block.input);
            }
          }
        }
        break;
      }
      case 'user': {
        const content = msg.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'object' && 'type' in block && block.type === 'tool_result') {
              const result = block as { tool_use_id: string; content?: string; is_error?: boolean };
              logEvent(`tool_result:${result.is_error ? ' (error)' : ''} ${result.content?.slice(0, 200) ?? ''}`);
            }
          }
        }
        break;
      }
      case 'result': {
        const noTokens = msg.usage.input_tokens === 0 && msg.usage.output_tokens === 0;
        if (noTokens) {
          const errorDetail = msg.subtype === 'success' ? msg.result : msg.errors.join(', ');
          logEvent(`\x1b[31mresult: ERROR (${msg.duration_ms}ms) ${errorDetail}\x1b[0m`);
        } else {
          logEvent(`result: ${msg.subtype} cost=$${msg.total_cost_usd.toFixed(4)} turns=${msg.num_turns} duration=${msg.duration_ms}ms`);
          for (const [model, mu] of Object.entries(msg.modelUsage)) {
            const shortModel = model.replace(/^claude-/, '');
            const input = (mu.inputTokens ?? 0) + (mu.cacheCreationInputTokens ?? 0) + (mu.cacheReadInputTokens ?? 0);
            const output = mu.outputTokens ?? 0;
            const window = mu.contextWindow ?? 0;
            const pct = window > 0 ? ` (${((input / window) * 100).toFixed(1)}%)` : '';
            logEvent(`  ${shortModel}: in=${input.toLocaleString()}${window > 0 ? `/${window.toLocaleString()}` : ''}${pct} out=${output.toLocaleString()} $${mu.costUSD.toFixed(4)}`);
            if (mu.cacheReadInputTokens || mu.cacheCreationInputTokens) {
              logEvent(`    cache: read=${(mu.cacheReadInputTokens ?? 0).toLocaleString()} created=${(mu.cacheCreationInputTokens ?? 0).toLocaleString()} uncached=${(mu.inputTokens ?? 0).toLocaleString()}`);
            }
          }
        }
        break;
      }
      case 'stream_event':
        break;
      default:
        logEvent(msg.type);
        break;
    }
  });

  try {
    term.status('Waiting for 0s...');
    pendingStatus = true;
    await session.send(text);
  } catch (err) {
    if (session.wasAborted) {
      logEvent('Aborted');
    } else {
      logEvent(`Error: ${err}`);
    }
  } finally {
    clearInterval(timer);
    session.removeAllListeners();
    if (session.currentSessionId) {
      saveSession(session.currentSessionId);
    }
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    logEvent(`Done after ${elapsed}s`);
  }
  redraw();
}

function redraw(): void {
  renderState = render(editor, renderState, (data) => term.write(data));
}

function onKeypress(data: Buffer): void {
  const key = parseKey(data.toString('utf8'));

  switch (key.type) {
    case 'ctrl+c':
      session.cancel();
      cleanup();
      process.exit(0);
    case 'escape':
      term.write('\n');
      term.log('Escape pressed');
      if (session.isActive) {
        term.log('Aborting query...');
        session.cancel();
      }
      return;
  }

  if (pendingQuestion) {
    if (questionOtherMode) {
      if (key.type === 'enter') {
        term.write('\n');
        if (otherBuffer.trim()) {
          term.log(`→ ${otherBuffer}`);
          questionOtherMode = false;
          advanceQuestion(otherBuffer);
          otherBuffer = '';
        } else {
          term.write('> ');
        }
      } else if (key.type === 'backspace') {
        if (otherBuffer.length > 0) {
          otherBuffer = otherBuffer.slice(0, -1);
          term.write('\b \b');
        }
      } else if (key.type === 'char') {
        otherBuffer += key.value;
        term.write(key.value);
      }
      return;
    }
    if (key.type === 'char') {
      resolveQuestionKey(key.value);
    }
    return;
  }

  if (permissionQueue.length > 0) {
    if (key.type === 'char' && (key.value === 'y' || key.value === 'Y')) {
      term.log('Allowed');
      resolvePermission(true);
      return;
    }
    if (key.type === 'char' && (key.value === 'n' || key.value === 'N')) {
      term.log('Denied');
      resolvePermission(false);
      return;
    }
    return;
  }

  if (session.isActive) return;

  switch (key.type) {
    case 'ctrl+d': {
      cleanup();
      term.info('Goodbye.');
      process.exit(0);
    }
    case 'ctrl+enter':
      submit();
      return;
    case 'enter':
      editor = insertNewline(editor);
      break;
    case 'backspace':
      editor = backspace(editor);
      break;
    case 'delete':
      editor = deleteChar(editor);
      break;
    case 'ctrl+delete':
      editor = deleteWord(editor);
      break;
    case 'ctrl+backspace':
      editor = deleteWordBackward(editor);
      break;
    case 'left':
      editor = moveLeft(editor);
      break;
    case 'right':
      editor = moveRight(editor);
      break;
    case 'up':
      editor = moveUp(editor);
      break;
    case 'down':
      editor = moveDown(editor);
      break;
    case 'home':
      editor = moveHome(editor);
      break;
    case 'end':
      editor = moveEnd(editor);
      break;
    case 'ctrl+home':
      editor = moveBufferStart(editor);
      break;
    case 'ctrl+end':
      editor = moveBufferEnd(editor);
      break;
    case 'ctrl+left':
      editor = moveWordLeft(editor);
      break;
    case 'ctrl+right':
      editor = moveWordRight(editor);
      break;
    case 'char':
      editor = insertChar(editor, key.value);
      break;
    case 'unknown':
      return;
  }

  redraw();
}

function cleanup(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.removeListener('data', onKeypress);
}

function start(): void {
  const auditPath = initAudit();

  term.info('claude-cli v0.0.3');
  term.info(`cwd: ${process.cwd()}`);
  term.info(`audit: ${auditPath}`);
  term.info(`session file: ${SESSION_FILE}`);

  const savedSession = loadSession((msg) => term.info(msg));
  if (savedSession) {
    session.setSessionId(savedSession);
    term.info(`Resuming session: ${savedSession}`);
  } else {
    term.info('Starting new session');
  }
  term.info('Enter = newline, Ctrl+Enter = send, Ctrl+C = quit');
  term.info('Commands: /quit, /exit, /session [id], /compact-at <uuid>');
  term.info('---');

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', onKeypress);

  process.stdout.on('resize', () => {
    redraw();
  });

  redraw();
}

start();
