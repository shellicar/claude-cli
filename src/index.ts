import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
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
import { parseKey } from './input.js';
import { render, createRenderState, type RenderState } from './renderer.js';

let sessionId: string | undefined;
let editor: EditorState = createEditor();
let renderState: RenderState = createRenderState();
let processing = false;

function buildOptions(prompt: string): { prompt: string; options: Options } {
  const options: Options = {
    model: 'claude-sonnet-4-5-20250929',
    cwd: process.cwd(),
    maxTurns: 1,
    ...(sessionId ? { resume: sessionId } : {}),
  } satisfies Options;

  return { prompt, options };
}

async function send(input: string, onFirstOutput: () => void): Promise<void> {
  const q = query(buildOptions(input));
  let hasAssistantOutput = false;

  for await (const msg of q) {
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          sessionId = msg.session_id;
        }
        break;
      }
      case 'assistant': {
        if (!hasAssistantOutput) {
          onFirstOutput();
          hasAssistantOutput = true;
        }
        process.stdout.write(
          msg.message.content.map((block) => ('text' in block ? block.text : '')).join(''),
        );
        break;
      }
      case 'result': {
        if (msg.subtype === 'success') {
          if (!hasAssistantOutput) {
            onFirstOutput();
            process.stdout.write(msg.result);
          }
          process.stdout.write('\n');
        } else {
          process.stderr.write(`Error: ${JSON.stringify(msg)}\n`);
        }
        break;
      }
      case 'auth_status':
      case 'stream_event':
      case 'tool_progress':
      case 'tool_use_summary':
      case 'user':
        break;
    }
  }
}

function handleCommand(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '/quit' || trimmed === '/exit') {
    cleanup();
    console.log('Goodbye.');
    process.exit(0);
  }
  if (trimmed === '/session' || trimmed.startsWith('/session ')) {
    const arg = trimmed.slice('/session'.length).trim();
    if (arg) {
      sessionId = arg;
      console.log(`Switched to session: ${sessionId}`);
    } else {
      console.log(`Session: ${sessionId ?? 'none'}`);
    }
    return true;
  }
  return false;
}

async function submit(): Promise<void> {
  const text = getText(editor);
  if (!text.trim()) return;

  // Clear input area and print the submitted text
  editor = clear(editor);
  renderState = createRenderState();
  process.stdout.write('\n');

  if (handleCommand(text)) {
    redraw();
    return;
  }

  processing = true;
  const startTime = Date.now();
  const timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    process.stdout.write(`\r\x1B[2KWaiting for ${seconds}s...`);
  }, 500);

  try {
    process.stdout.write('Waiting for 0s...');
    await send(text, () => {
      clearInterval(timer);
      process.stdout.write(`\r\x1B[2K`);
    });
  } catch (err) {
    console.error('Error:', err);
  } finally {
    clearInterval(timer);
    processing = false;
  }
  redraw();
}

function redraw(): void {
  renderState = render(editor, renderState, (data) => process.stdout.write(data));
}

function onKeypress(data: Buffer): void {
  if (processing) return;

  const key = parseKey(data.toString('utf8'));

  switch (key.type) {
    case 'ctrl+c':
      cleanup();
      process.exit(0);
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
  console.log('claude-cli v0.0.1');
  console.log('Enter = newline, Ctrl+Enter = send, Ctrl+C = quit');
  console.log('Commands: /quit, /exit, /session [id]');
  console.log('---');

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
