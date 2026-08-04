// Measures prompt-cache behaviour of the real request the CLI sends.
//
// The conversation is entirely synthetic: fixed user messages and canned assistant
// replies, so the request bytes are identical run to run. That is what makes a second
// run meaningful. A real assistant reply would differ every time and every turn after
// it would miss for reasons that have nothing to do with the thing being measured.
//
// Run from scripts/:
//   pnpm tsx src/cache-probe.ts --dry                 hashes only, no API calls, free
//   pnpm tsx src/cache-probe.ts                       live, 5 turns
//   pnpm tsx src/cache-probe.ts --server-tools-at 3   region 1 changes at turn 3
//   pnpm tsx src/cache-probe.ts --model claude-opus-4-8 --effort low --effort-at 3 high
//                                                     thinking effort changes at turn 3

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Clock } from '@js-joda/core';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import type { HistoryReadRequest, HistorySearchHit, HistorySearchQuery, HistoryWindow } from '@shellicar/claude-core/history/types';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { MemoryDraft, MemoryEntry, MemorySearchHit, MemoryTypeCount } from '@shellicar/claude-core/memory/types';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { AnthropicBeta, AnthropicClient, type AuthCredentials, type BetaMessageParam, type BetaToolUnion, buildRequestParams, CacheTtl, ICredentialProvider, type RequestBuilderOptions, type ThinkingEffort } from '@shellicar/claude-sdk';
import { createAppTools } from '@shellicar/claude-sdk-cli/src/createAppTools.js';
import { ISecrets } from '@shellicar/claude-sdk-cli/src/secrets/Secrets.js';
import { IEnvProvider, StaticRulesConfigProvider } from '@shellicar/claude-sdk-tools/ExecV3';
import type { ITypeScriptService } from '@shellicar/claude-sdk-tools/TsService';

type TextBlock = { type: 'text'; text: string };

const TURNS = 5;
const CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json');

const args = process.argv.slice(2);
function flag(name: string): string | null {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}

const dryRun = args.includes('--dry');
const MODEL = flag('--model') ?? 'claude-haiku-4-5';
const serverToolsAt = flag('--server-tools-at') == null ? null : Number(flag('--server-tools-at'));
const baseEffort = flag('--effort') as ThinkingEffort | null;
const switchEffortAt = flag('--effort-at') == null ? null : Number(flag('--effort-at'));
const switchEffort = (switchEffortAt == null ? null : (args[args.indexOf('--effort-at') + 2] ?? null)) as ThinkingEffort | null;
const thinking = baseEffort != null;

/** The effort in force for a given turn, so an effort switch is a per-turn fact rather than a mode. */
function effortFor(turn: number): ThinkingEffort | undefined {
  if (switchEffortAt != null && switchEffort != null && turn >= switchEffortAt) {
    return switchEffort;
  }
  return baseEffort ?? undefined;
}

class StubObjectStore extends IObjectStore {
  public set(): void {}
  public get(): string | undefined {
    return undefined;
  }
}

class StubMemoryStore extends IMemoryStore {
  public async write(draft: MemoryDraft): Promise<MemoryEntry> {
    return { id: '', title: draft.title, body: draft.body, type: draft.type, keywords: draft.keywords, environment: {}, createdAt: '' };
  }
  public async read(): Promise<MemoryEntry | undefined> {
    return undefined;
  }
  public async search(): Promise<MemorySearchHit[]> {
    return [];
  }
  public async delete(): Promise<void> {}
  public async types(): Promise<MemoryTypeCount[]> {
    return [];
  }
}

class StubHistoryReader extends IHistoryReader {
  public search(_query: HistorySearchQuery): HistorySearchHit[] {
    return [];
  }
  public read(_request: HistoryReadRequest): HistoryWindow[] {
    return [];
  }
}

class StubSecrets extends ISecrets {
  public ghHolderToken(): string {
    return '';
  }
  public ghReaderToken(): string {
    return '';
  }
  public azCert(): string {
    return '';
  }
}

class StubEnvProvider extends IEnvProvider {
  public buildEnv(cmdEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return { ...process.env, ...cmdEnv };
  }
}

class SilentLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

/** Reads the credentials the CLI already stored. Refuses an expired token rather than
 *  refreshing it, so this probe never writes to the shared credential file. */
class StoredCredentialProvider extends ICredentialProvider {
  public async get(): Promise<AuthCredentials> {
    const raw = await readFile(CREDENTIALS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as AuthCredentials;
    if (parsed.claudeAiOauth.expiresAt <= Date.now()) {
      throw new Error('Stored credentials have expired. Start the CLI once to refresh them, then re-run.');
    }
    return parsed;
  }
}

const { tools } = createAppTools({
  fs: null as unknown as IFileSystem,
  tsServer: null as unknown as ITypeScriptService,
  toolsConfig: { exec: false, execV2: false, execV3: true },
  rulesProvider: new StaticRulesConfigProvider(),
  objects: new StubObjectStore(),
  memory: new StubMemoryStore(),
  history: new StubHistoryReader(),
  currentSessionId: () => '',
  clock: Clock.systemUTC(),
  tsAvailable: false,
  logger: new SilentLogger(),
  secrets: new StubSecrets(),
  envProvider: new StubEnvProvider(),
  getAzAccounts: () => ({}),
});

const SYSTEM_PROMPTS = ['You are a probe. Answer every message with the single word: ok.', 'Stay terse. One word only. Never explain.'];

const CACHED_REMINDERS = ['The following skills are available for use with the Skill tool:\n\n- probe: a fixed catalogue entry, standing in for the real one.', 'Codebase and user instructions are shown below.\n\nThis is fixed CLAUDE.md content, standing in for the real file.'];

const SERVER_TOOLS: BetaToolUnion[] = [{ name: 'web_search', type: 'web_search_20260209', allowed_callers: ['direct'] } as BetaToolUnion];

/** Fixed user text per turn. Short: the point is the prefix, not these. */
const USER_TEXTS = Array.from({ length: TURNS }, (_, i) => `Probe message ${i + 1}. Reply with ok.`);

/** A canned assistant reply, so the conversation replays byte-identically. */
const ASSISTANT_REPLY: BetaMessageParam = { role: 'assistant', content: [{ type: 'text', text: 'ok' }] };

function reminderBlocks(texts: string[]): TextBlock[] {
  return texts.map((text, i, arr) => ({ type: 'text' as const, text: `<system-reminder>\n${text}\n</system-reminder>\n${i === arr.length - 1 ? '\n' : ''}` }));
}

/** The conversation as it stands before turn `turn` (1-based), ending on a user message. */
function messagesFor(turn: number): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (let i = 0; i < turn; i++) {
    const text = USER_TEXTS[i] ?? '';
    const content = i === 0 ? [...reminderBlocks(CACHED_REMINDERS), { type: 'text' as const, text }] : [{ type: 'text' as const, text }];
    out.push({ role: 'user', content });
    if (i < turn - 1) {
      out.push(ASSISTANT_REPLY);
    }
  }
  return out;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

/** Every cache_control marker in the body, in prefix order, so the marker layout is visible
 *  rather than assumed. */
function markers(body: { tools?: unknown[]; system?: unknown; messages: BetaMessageParam[] }): string[] {
  const found: string[] = [];
  body.tools?.forEach((t, i) => {
    if ((t as { cache_control?: unknown }).cache_control != null) {
      found.push(`tools[${i}]`);
    }
  });
  if (Array.isArray(body.system)) {
    body.system.forEach((b, i) => {
      if ((b as { cache_control?: unknown }).cache_control != null) {
        found.push(`system[${i}]`);
      }
    });
  }
  body.messages.forEach((m, mi) => {
    if (!Array.isArray(m.content)) {
      return;
    }
    m.content.forEach((b: unknown, bi: number) => {
      if ((b as { cache_control?: unknown }).cache_control != null) {
        found.push(`messages[${mi}].content[${bi}]`);
      }
    });
  });
  return found;
}

function optionsFor(turn: number): RequestBuilderOptions {
  const withServerTools = serverToolsAt != null && turn >= serverToolsAt;
  return {
    model: MODEL,
    maxTokens: thinking ? 4096 : 16,
    thinking,
    thinkingEffort: effortFor(turn),
    tools,
    serverTools: withServerTools ? SERVER_TOOLS : [],
    transformTool: (tool) => {
      const { input_examples: _drop, ...rest } = tool as BetaToolUnion & { input_examples?: unknown };
      return rest as BetaToolUnion;
    },
    betas: { [AnthropicBeta.ClaudeCodeAuth]: true },
    systemPrompts: SYSTEM_PROMPTS,
    cachedReminders: CACHED_REMINDERS,
    cacheTtl: CacheTtl.OneHour,
  };
}

type Usage = { input: number; write: number; read: number; output: number };

/** What the numbers mean, stated so a run reads without arithmetic. A cold prefix reads nothing
 *  and writes everything, which is the signature of an invalidation. */
function verdict(u: Usage): string {
  if (u.read === 0) {
    return 'COLD: nothing cached, whole prefix written';
  }
  if (u.write === 0) {
    return 'FULL HIT: nothing written';
  }
  return `PARTIAL: ${u.read} cached, ${u.write} written`;
}

async function send(client: AnthropicClient, body: Parameters<AnthropicClient['stream']>[0], headers: Record<string, string>): Promise<Usage> {
  const usage: Usage = { input: 0, write: 0, read: 0, output: 0 };
  for await (const event of client.stream(body, { headers })) {
    if (event.type === 'message_start') {
      const u = event.message.usage;
      usage.input = u.input_tokens;
      usage.write = u.cache_creation_input_tokens ?? 0;
      usage.read = u.cache_read_input_tokens ?? 0;
    }
    if (event.type === 'message_delta') {
      usage.output = event.usage.output_tokens ?? 0;
    }
  }
  return usage;
}

async function main(): Promise<void> {
  const client = dryRun ? null : new AnthropicClient(new StoredCredentialProvider(), new SilentLogger());

  console.log(`model=${MODEL} turns=${TURNS} tools=${tools.length} thinking=${thinking}${serverToolsAt == null ? '' : ` server-tools-from=${serverToolsAt}`}${switchEffortAt == null ? '' : ` effort-switch=${switchEffort}@${switchEffortAt}`}${dryRun ? ' (dry run, no API calls)' : ''}`);
  console.log('');
  console.log('turn  effort  toolsHash     systemHash    claudeMdHash  markers');

  for (let turn = 1; turn <= TURNS; turn++) {
    const { body, headers } = buildRequestParams(optionsFor(turn), messagesFor(turn));
    const firstUser = body.messages[0];
    const claudeMdPrefix = Array.isArray(firstUser?.content) ? firstUser.content.slice(0, CACHED_REMINDERS.length) : [];

    const toolsHash = hash(body.tools);
    const systemHash = hash(body.system);
    const claudeMdHash = hash(claudeMdPrefix);
    console.log(`${String(turn).padEnd(6)}${(effortFor(turn) ?? '-').padEnd(8)}${toolsHash}  ${systemHash}  ${claudeMdHash}  ${markers(body).join(' ')}`);

    if (client != null) {
      const u = await send(client, body, headers);
      console.log(`      usage: in=${u.input} write=${u.write} read=${u.read} out=${u.output}  ${verdict(u)}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
