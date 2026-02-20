import { AppState } from './AppState.js';
import { AuditWriter } from './AuditWriter.js';
import { getConfig, isInsideCwd } from './config.js';
import { formatDiff } from './diff.js';
import { backspace, clear, createEditor, deleteChar, deleteWord, deleteWordBackward, type EditorState, getText, insertChar, insertNewline, moveBufferEnd, moveBufferStart, moveDown, moveEnd, moveHome, moveLeft, moveRight, moveUp, moveWordLeft, moveWordRight } from './editor.js';
import { discoverSkills, initFiles } from './files.js';
import { parseKey } from './input.js';
import { type AskQuestion, PromptManager } from './PromptManager.js';
import { SdkResult } from './SdkResult.js';
import { SessionManager } from './SessionManager.js';
import { QuerySession } from './session.js';
import { Terminal } from './terminal.js';
import { type ContextUsage, UsageTracker } from './UsageTracker.js';

let audit!: AuditWriter;
let prompts!: PromptManager;
let sessions!: SessionManager;

const appState = new AppState();
const term = new Terminal(appState);
const session = new QuerySession();
const usage = new UsageTracker();
let editor: EditorState = createEditor();

function contextColor(percent: number): string {
  return percent > 80 ? '\x1b[31m' : percent > 50 ? '\x1b[33m' : '\x1b[32m';
}

function formatContext(ctx: ContextUsage): string {
  const color = contextColor(ctx.percent);
  return `${color}context: ${ctx.used.toLocaleString()}/${ctx.window.toLocaleString()} (${ctx.percent.toFixed(1)}%)\x1b[0m`;
}

session.canUseTool = (toolName, input, options) => {
  const config = getConfig();
  const cwd = process.cwd();
  const signal = options?.signal;

  const allow = (updatedInput: Record<string, unknown>) => Promise.resolve({ behavior: 'allow' as const, updatedInput });

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
  if (!text.trim()) {
    return;
  }

  editor = clear(editor);
  term.log(`> ${text}`);

  if (handleCommand(text)) {
    redraw();
    return;
  }

  const startTime = Date.now();
  term.log('Sending query...');
  appState.sending();

  let firstMessage = true;
  session.on('message', (msg) => {
    if (firstMessage) {
      firstMessage = false;
      appState.thinking();
    }
    audit.write(msg);
    usage.onMessage(msg);

    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          term.log(`session: ${msg.session_id} model: ${msg.model}`);
        } else {
          term.log(`system: ${msg.subtype}`);
        }
        break;
      case 'assistant': {
        const ctx = usage.context;
        const pctSuffix = ctx ? ` ${contextColor(ctx.percent)}(${ctx.percent.toFixed(1)}%)\x1b[0m` : '';
        term.log(`\x1b[2mmessageId: ${msg.uuid}\x1b[0m${pctSuffix}`);
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            term.log(`assistant: ${block.text}`);
          } else if (block.type === 'tool_use') {
            if (block.name === 'Edit') {
              const input = block.input as { file_path?: string; old_string?: string; new_string?: string };
              term.log(`tool_use: Edit ${input.file_path ?? 'unknown'}`);
              if (input.old_string && input.new_string) {
                term.info(formatDiff(input.file_path ?? 'unknown', input.old_string, input.new_string));
              }
            } else if (block.name === 'ExitPlanMode') {
              const input = block.input as { plan?: string };
              term.log('tool_use: ExitPlanMode');
              if (input.plan) {
                term.info(input.plan);
              }
            } else {
              term.log(`tool_use: ${block.name}`, block.input);
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
              term.log(`tool_result:${result.is_error ? ' (error)' : ''} ${result.content?.slice(0, 200) ?? ''}`);
            }
          }
        }
        break;
      }
      case 'result': {
        if (msg.subtype === 'success') {
          const sdkResult = new SdkResult(msg);
          if (sdkResult.isRateLimited) {
            term.log(`\x1b[31mresult: RATE LIMITED (${msg.duration_ms}ms) ${msg.result}\x1b[0m`);
          } else if (sdkResult.isApiError) {
            term.log(`\x1b[31mresult: API ERROR ${sdkResult.apiError?.statusCode} (${msg.duration_ms}ms) ${sdkResult.apiError?.errorType}: ${sdkResult.apiError?.errorMessage}\x1b[0m`);
          } else if (sdkResult.isError) {
            term.log(`\x1b[31mresult: ERROR is_error (${msg.duration_ms}ms) ${msg.result}\x1b[0m`, msg);
          } else if (sdkResult.noTokens) {
            term.log(`\x1b[31mresult: ERROR no_tokens (${msg.duration_ms}ms) ${msg.result}\x1b[0m`, msg);
          } else {
            term.log(`result: ${msg.subtype} cost=$${msg.total_cost_usd.toFixed(4)} turns=${msg.num_turns} duration=${msg.duration_ms}ms`);
          }
        } else {
          term.log(`\x1b[31mresult: ERROR ${msg.subtype} (${msg.duration_ms}ms) ${msg.errors.join(', ')}\x1b[0m`);
        }

        usage.onResult(msg);

        for (const [model, mu] of Object.entries(msg.modelUsage)) {
          const shortModel = model.replace(/^claude-/, '');
          const input = (mu.inputTokens ?? 0) + (mu.cacheCreationInputTokens ?? 0) + (mu.cacheReadInputTokens ?? 0);
          const output = mu.outputTokens ?? 0;
          const window = mu.contextWindow ?? 0;
          const pct = window > 0 ? ` (${((input / window) * 100).toFixed(1)}%)` : '';
          term.log(`  ${shortModel}: in=${input.toLocaleString()}${window > 0 ? `/${window.toLocaleString()}` : ''}${pct} out=${output.toLocaleString()} $${mu.costUSD.toFixed(4)}`);
          if (mu.cacheReadInputTokens || mu.cacheCreationInputTokens) {
            term.log(`    cache: read=${(mu.cacheReadInputTokens ?? 0).toLocaleString()} created=${(mu.cacheCreationInputTokens ?? 0).toLocaleString()} uncached=${(mu.inputTokens ?? 0).toLocaleString()}`);
          }
        }

        const ctx = usage.context;
        if (ctx) {
          term.log(`  ${formatContext(ctx)}`);
        }
        term.log(`  session: $${usage.sessionCost.toFixed(4)}`);
        break;
      }
      case 'stream_event':
        break;
      default:
        term.log(msg.type);
        break;
    }
  });

  try {
    redraw();
    await session.send(text);
  } catch (err) {
    if (session.wasAborted) {
      term.log('Aborted');
    } else {
      term.log(`Error: ${err}`);
    }
  } finally {
    appState.idle();
    session.removeAllListeners('message');
    if (session.currentSessionId) {
      sessions.save(session.currentSessionId);
    }
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    term.log(`Done after ${elapsed}s`);
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
  const busy = appState.phase !== 'idle';
  const prompt = busy ? '⏳ ' : '💬 ';
  term.renderEditor(editor, prompt, busy);
}

function onKeypress(data: string | Buffer): void {
  const key = parseKey(data.toString('utf8'));

  switch (key.type) {
    case 'ctrl+c': {
      session.cancel();
      cleanup();
      process.exit(0);
      break;
    }
    case 'escape':
      term.log('Escape pressed');
      if (session.isActive) {
        term.log('Aborting query...');
        prompts.cancelAll();
        setTimeout(() => session.cancel(), 0);
      }
      return;
  }

  if (prompts.handleKey(key)) {
    return;
  }

  if (session.isActive) {
    return;
  }

  switch (key.type) {
    case 'ctrl+d': {
      cleanup();
      term.info('Goodbye.');
      process.exit(0);
      break;
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

async function start(): Promise<void> {
  const paths = initFiles();
  audit = new AuditWriter(paths.auditFile);
  prompts = new PromptManager(term, appState);
  sessions = new SessionManager(paths.sessionFile);

  term.info('claude-cli v0.0.3');
  term.info(`cwd: ${process.cwd()}`);
  term.info(`audit: ${paths.auditFile}`);
  term.info(`session file: ${paths.sessionFile}`);

  const savedSession = sessions.load((msg) => term.info(msg));
  if (savedSession) {
    session.setSessionId(savedSession);
    term.info(`Resuming session: ${savedSession}`);
    usage.loadContextFromAudit(paths.auditFile, savedSession);
    const lastAssistant = usage.lastAssistant;
    if (lastAssistant) {
      term.info(`\x1b[2mlast messageId: ${lastAssistant.uuid}\x1b[0m`);
    }
    const ctx = usage.context;
    if (ctx) {
      term.info(formatContext(ctx));
    }
    await usage.loadCostFromAudit(paths.auditFile, savedSession);
    if (usage.sessionCost > 0) {
      term.info(`session: $${usage.sessionCost.toFixed(4)}`);
    }
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
  appState.on('changed', () => {
    term.refresh();
    redraw();
  });

  showSkills();
  redraw();
}

start();
