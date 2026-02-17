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
import { AuditWriter } from './AuditWriter.js';
import { discoverSkills, initFiles } from './files.js';
import { getConfig, isInsideCwd, isSafeBashCommand } from './config.js';
import { formatDiff } from './diff.js';
import { parseKey } from './input.js';
import { PromptManager, type AskQuestion } from './PromptManager.js';
import { render, createRenderState, type RenderState } from './renderer.js';
import { QuerySession } from './session.js';
import { Terminal } from './terminal.js';

let sessionFile = '';
let audit!: AuditWriter;
let prompts!: PromptManager;

function loadSession(log: (msg: string) => void): string | undefined {
  if (!existsSync(sessionFile)) {
    log(`No session file found at ${sessionFile}`);
    return undefined;
  }
  try {
    const content = readFileSync(sessionFile, 'utf8').trim();
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
  writeFileSync(sessionFile, id);
}

const term = new Terminal();
const session = new QuerySession();
let editor: EditorState = createEditor();
let renderState: RenderState = createRenderState();

session.canUseTool = (toolName, input, options) => {
  const config = getConfig();
  const cwd = process.cwd();
  const signal = options?.signal;

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
      return prompts.requestQuestion(questions, input, signal);
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

  return prompts.requestPermission(toolName, input, signal);
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
    audit.write(msg);

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
  showSkills();
  redraw();
}

function showSkills(): void {
  const skills = discoverSkills();
  if (skills.length > 0) {
    term.log(`skills: ${skills.map((s) => s.name).join(', ')}`);
  }
}

function redraw(): void {
  renderState = render(editor, renderState, (data) => term.write(data));
}

function onKeypress(data: string | Buffer): void {
  const key = parseKey(data.toString('utf8'));

  switch (key.type) {
    case 'ctrl+c': {
      session.cancel();
      cleanup();
      process.exit(0);
    }
    case 'escape':
      term.write('\n');
      term.log('Escape pressed');
      if (session.isActive) {
        term.log('Aborting query...');
        prompts.cancelAll();
        setTimeout(() => session.cancel(), 0);
      }
      return;
  }

  if (prompts.handleKey(key)) return;

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
  process.stdout.removeListener('resize', redraw);
  process.stdin.pause();
}

function start(): void {
  const paths = initFiles();
  audit = new AuditWriter(paths.auditFile);
  prompts = new PromptManager(term);
  sessionFile = paths.sessionFile;

  term.info('claude-cli v0.0.3');
  term.info(`cwd: ${process.cwd()}`);
  term.info(`audit: ${paths.auditFile}`);
  term.info(`session file: ${paths.sessionFile}`);

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
  process.stdout.on('resize', redraw);

  showSkills();
  redraw();
}

start();
