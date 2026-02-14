import { createInterface } from 'node:readline';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

let sessionId: string | undefined;

function buildOptions(prompt: string): { prompt: string; options: Options } {
  const options: Options = {
    model: 'claude-sonnet-4-5-20250929',
    cwd: process.cwd(),
    maxTurns: 1,
    ...(sessionId ? { resume: sessionId } : {}),
  } satisfies Options;

  return { prompt, options };
}

async function send(input: string): Promise<void> {
  const q = query(buildOptions(input));
  let hasAssistantOutput = false;

  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      sessionId = msg.session_id;
    }
    if (msg.type === 'assistant') {
      hasAssistantOutput = true;
      process.stdout.write(msg.message.content.map((block) => ('text' in block ? block.text : '')).join(''));
    }
    if (msg.type === 'result') {
      if (msg.subtype === 'success') {
        if (!hasAssistantOutput) {
          process.stdout.write(msg.result);
        }
        process.stdout.write('\n');
      } else {
        process.stderr.write(`Error: ${JSON.stringify(msg)}\n`);
      }
    }
  }
}

function prompt(): void {
  rl.question('> ', async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      prompt();
      return;
    }
    if (trimmed === '/quit' || trimmed === '/exit') {
      console.log('Goodbye.');
      rl.close();
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
      prompt();
      return;
    }

    try {
      await send(trimmed);
    } catch (err) {
      console.error('Error:', err);
    }
    prompt();
  });
}

console.log('claude-cli v0.0.1');
console.log('Commands: /quit, /exit, /session');
console.log('---');
prompt();
