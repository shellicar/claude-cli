import { Clock, Instant, ZoneOffset } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IRandomProvider } from '@shellicar/claude-core/providers/IRandomProvider';
import { ISleepProvider } from '@shellicar/claude-core/providers/ISleepProvider';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { ApprovalCoordinator } from '../src/private/ApprovalCoordinator.js';
import { Conversation } from '../src/private/Conversation.js';
import { type IMessageStream, IMessageStreamer } from '../src/private/MessageStreamer.js';
import { QueryRunner } from '../src/private/QueryRunner.js';
import { TurnRunner } from '../src/private/TurnRunner.js';
import type { MessageStreamResult } from '../src/private/types.js';
import { IDurableConfigProvider } from '../src/public/IDurableConfigProvider.js';
import { ISdkMessagePublisher } from '../src/public/ISdkMessagePublisher.js';
import { IStreamProcessor, IToolRegistry, ITurnRunner, IWakeLock } from '../src/public/interfaces.js';
import type { DurableConfig, PerQueryInput, SystemReminder, ToolResolveResult } from '../src/public/types.js';
import { AccountLimitListener, IRequestClockListener, IToolBlockNotifier, IToolsClockListener, StreamInterruptListener } from '../src/public/types.js';

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

const zeroUsage = { inputTokens: 0, cacheCreationTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0, outputTokens: 0 };

class ScriptedStreamer extends IMessageStreamer {
  public readonly calls: { body: unknown }[] = [];
  public constructor(private readonly hangUntil?: AbortSignal) {
    super();
  }
  public stream(body: unknown): IMessageStream {
    this.calls.push({ body });
    const hangUntil = this.hangUntil;
    return (async function* () {
      if (hangUntil) {
        await new Promise((_resolve, reject) => hangUntil.addEventListener('abort', () => reject(new Error('aborted'))));
      }
    })();
  }
}

class ScriptedProcessor extends IStreamProcessor {
  #used = false;
  public constructor(private readonly result: MessageStreamResult | Error) {
    super();
  }
  public async process(): Promise<MessageStreamResult> {
    if (this.#used) {
      throw new Error('ScriptedProcessor: only scripted for a single call');
    }
    this.#used = true;
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

class FakeDurableConfigProvider extends IDurableConfigProvider {
  public config: DurableConfig = { model: 'claude-opus-4-5' as DurableConfig['model'], maxTokens: 1024, tools: [] };
  public update(): void {}
  public updateIdentityBody(): void {}
  public async resolveSystemPromptsFor(): Promise<void> {}
  public async resolveSkillCatalogue(): Promise<void> {}
  public needsSystemPromptResolve(): boolean {
    return false;
  }
  public getEffectiveModel(): string {
    return this.config.model;
  }
  public getEffectiveThinkingEnabled(): boolean {
    return false;
  }
  public getEffectiveEffort(): undefined {
    return undefined;
  }
}

// Resolves every tool_use immediately with a fixed ok result — the tool identity/input
// doesn't matter to this test, only that a tool_result comes back for it.
class OkToolRegistry extends IToolRegistry {
  public get wireTools(): never[] {
    return [];
  }
  public resolve(): ToolResolveResult {
    return { kind: 'ready', run: async () => ({ kind: 'ok', content: 'tool ran' }) };
  }
  public normaliseInputPaths(): void {}
}

function runQuery(conversation: Conversation, streamer: IMessageStreamer, processor: IStreamProcessor, input: PerQueryInput): Promise<void> {
  const services = createServiceCollection();
  services.register(IMessageStreamer).to(IMessageStreamer, () => streamer);
  services.register(IStreamProcessor).to(IStreamProcessor, () => processor);
  services.register(ILogger).to(ILogger, () => new NoopLogger());
  services.register(AccountLimitListener).to(AccountLimitListener, () => ({ retrying: () => {}, stopped: () => {} }));
  services.register(ISleepProvider).to(ISleepProvider, () => ({ sleep: async () => {} }));
  services.register(IRandomProvider).to(IRandomProvider, () => ({ next: () => 0 }));
  services.register(Clock).to(Clock, () => Clock.fixed(Instant.ofEpochMilli(0), ZoneOffset.UTC));
  services.register(IWakeLock).to(IWakeLock, () => ({ acquire: () => ({ release: () => {} }) }));
  services.register(StreamInterruptListener).to(StreamInterruptListener, () => ({ reconnecting: () => {} }));
  services.register(IRequestClockListener).to(IRequestClockListener, () => ({ requestStarted: () => {}, requestSettled: () => {} }));
  services.register(TurnRunner).to(TurnRunner);
  services.register(ITurnRunner).to(ITurnRunner, (p) => p.resolve(TurnRunner));
  services.register(Conversation).to(Conversation, () => conversation);
  services.register(IToolRegistry).to(IToolRegistry, () => new OkToolRegistry());
  services.register(ApprovalCoordinator).to(ApprovalCoordinator);
  services.register(ISdkMessagePublisher).to(ISdkMessagePublisher, () => ({ send: () => {}, close: () => {}, drain: async () => {} }));
  services.register(IDurableConfigProvider).to(IDurableConfigProvider, () => new FakeDurableConfigProvider());
  services.register(IToolsClockListener).to(IToolsClockListener, () => ({ toolsStarted: () => {}, toolsStopped: () => {} }));
  services.register(IToolBlockNotifier).to(IToolBlockNotifier, () => ({ blockEnded: async () => {} }));
  services.register(QueryRunner).to(QueryRunner);
  return services.buildProvider().resolve(QueryRunner).run(input);
}

// Mirrors runAgent.ts: the CLI attaches these as persisted-leading reminders on the message
// that carries them (skill catalogue delta, cwd delta) — the same shape a real ctrl-c-then-resend
// or a plain cd/skill-update turn produces.
const cwdAndSkillReminders: SystemReminder[] = [
  { text: 'skill updated', persisted: true, position: 'leading' },
  { text: 'cwd changed', persisted: true, position: 'leading' },
];

async function sendMessageAfterCancelledToolResult(reminders?: SystemReminder[]): Promise<Array<{ type: string; text?: string }>> {
  const conversation = new Conversation();

  // Query 1: ask -> tool_use -> tool_result pushed -> the next turn (the assistant's
  // reply to the tool_result) is cancelled via ESC before it resolves.
  const cancelSignal = new AbortController();
  await runQuery(conversation, new ScriptedStreamer(), new ScriptedProcessor({ blocks: [{ type: 'tool_use', id: 't1', name: 'Foo', input: {} }], stopReason: 'tool_use', contextManagementOccurred: false, usage: zeroUsage }), {
    messages: ['first ask'],
    transformToolResult: undefined,
    abortController: new AbortController(),
  });
  const secondTurn = runQuery(conversation, new ScriptedStreamer(cancelSignal.signal), new ScriptedProcessor(new Error('should not be reached')), {
    messages: [],
    transformToolResult: undefined,
    abortController: cancelSignal,
  }).catch(() => {});
  queueMicrotask(() => cancelSignal.abort());
  await secondTurn;

  // Query 2: the user types a brand new message. It merges onto the tool_result-ending
  // history (role alternation), so the tip carries the *old* tool_result's identity
  // (kind: 'agent') even though a real human ask just landed on it. ctrl-c commonly lands the
  // user back at a prompt where the cwd or the skill catalogue has since changed, so this new
  // message may itself carry its own leading reminders ahead of the literal typed text.
  const streamer2 = new ScriptedStreamer();
  await runQuery(conversation, streamer2, new ScriptedProcessor({ blocks: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', contextManagementOccurred: false, usage: zeroUsage }), {
    messages: ['hello again'],
    reminders,
    transformToolResult: undefined,
    abortController: new AbortController(),
  });

  const sentMessages = (streamer2.calls[0]?.body as { messages: Array<{ role: string; content: unknown }> }).messages;
  const tip = sentMessages.at(-1);
  return Array.isArray(tip?.content) ? (tip.content as Array<{ type: string; text?: string }>) : [];
}

async function sendFirstMessage(reminders?: SystemReminder[]): Promise<Array<{ type: string; text?: string }>> {
  const conversation = new Conversation();
  const streamer = new ScriptedStreamer();
  await runQuery(conversation, streamer, new ScriptedProcessor({ blocks: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', contextManagementOccurred: false, usage: zeroUsage }), {
    messages: ['hello'],
    reminders,
    transformToolResult: undefined,
    abortController: new AbortController(),
  });

  const sentMessages = (streamer.calls[0]?.body as { messages: Array<{ role: string; content: unknown }> }).messages;
  const tip = sentMessages.at(-1);
  return Array.isArray(tip?.content) ? (tip.content as Array<{ type: string; text?: string }>) : [];
}

describe('clock stamp after a query is cancelled following tool results', () => {
  it('keeps the earlier tool_result as the first content block', async () => {
    const expected = 'tool_result';

    const content = await sendMessageAfterCancelledToolResult();
    const actual = content[0]?.type;

    expect(actual).toBe(expected);
  });

  it('stamps the new message with a fresh timestamp', async () => {
    const content = await sendMessageAfterCancelledToolResult();
    const actual = content.some((b) => typeof b.text === 'string' && b.text.includes('<system-reminder>'));

    expect(actual).toBe(true);
  });

  it('places the timestamp after the tool_result and before the new user text', async () => {
    const content = await sendMessageAfterCancelledToolResult();
    const stampIdx = content.findIndex((b) => typeof b.text === 'string' && b.text.includes('<system-reminder>'));
    const userTextIdx = content.findIndex((b) => b.text === 'hello again');
    const actual = stampIdx > 0 && stampIdx < userTextIdx;

    expect(actual).toBe(true);
  });
});

describe('clock stamp placement relative to a cwd/skill-catalogue reminder on a plain message', () => {
  it('places the timestamp immediately before the literal user text, after the cwd/skill reminders', async () => {
    const content = await sendFirstMessage(cwdAndSkillReminders);
    const userTextIdx = content.findIndex((b) => b.text === 'hello');
    const expected = userTextIdx - 1;

    const stampIdx = content.findIndex((b) => typeof b.text === 'string' && b.text.includes('Thursday, 1 January 1970 at 00:00:00'));
    const actual = stampIdx;

    expect(actual).toBe(expected);
  });
});

describe('clock stamp placement after a cancelled tool result, with a cwd/skill-catalogue reminder on the resend', () => {
  it('keeps the tool_result as the first content block', async () => {
    const expected = 'tool_result';

    const content = await sendMessageAfterCancelledToolResult(cwdAndSkillReminders);
    const actual = content[0]?.type;

    expect(actual).toBe(expected);
  });

  it('places the timestamp immediately before the literal user text, after the cwd/skill reminders', async () => {
    const content = await sendMessageAfterCancelledToolResult(cwdAndSkillReminders);
    const userTextIdx = content.findIndex((b) => b.text === 'hello again');
    const expected = userTextIdx - 1;

    const stampIdx = content.findIndex((b) => typeof b.text === 'string' && b.text.includes('Thursday, 1 January 1970 at 00:00:00'));
    const actual = stampIdx;

    expect(actual).toBe(expected);
  });
});
