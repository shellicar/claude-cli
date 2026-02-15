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
import { getConfig, isInsideCwd, isReadOnlyTool } from './config.js';
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

  // Auto-approve read-only tools
  if (config.autoApproveReads && isReadOnlyTool(toolName)) {
    return { behavior: 'allow', updatedInput: input };
  }

  // Auto-approve edits inside cwd
  if (config.autoApproveEdits && (toolName === 'Edit' || toolName === 'Write')) {
    const filePath = (input as { file_path?: string }).file_path;
    if (filePath && isInsideCwd(filePath, cwd)) {
      term.log(`auto-approved: ${toolName} ${filePath}`);
      return { behavior: 'allow', updatedInput: input };
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
  return false;
}

async function submit(): Promise<void> {
  const text = getText(editor);
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
      case 'result':
        logEvent(`result: ${msg.subtype} cost=$${msg.total_cost_usd.toFixed(4)} turns=${msg.num_turns} duration=${msg.duration_ms}ms`);
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
  term.info('Commands: /quit, /exit, /session [id]');
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
