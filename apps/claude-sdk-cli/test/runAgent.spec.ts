import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IQueryRunner, type QueryOutcome } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { ConversationState, IConversationState } from '../src/model/ConversationState.js';
import { PrimaryViewState } from '../src/model/PrimaryViewState.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { buildRunAgentInput, runAgent } from '../src/runAgent.js';
import { buildEditorBuffer } from './buildEditorBuffer.js';

describe('buildRunAgentInput', () => {
  it('returns a null message on resume', () => {
    const actual = buildRunAgentInput({ text: '', images: [], resume: true }).message;
    expect(actual).toBeNull();
  });

  it('returns an empty displayText on resume', () => {
    const actual = buildRunAgentInput({ text: '', images: [], resume: true }).displayText;
    expect(actual).toBe('');
  });

  it('builds a user message for a normal text input', () => {
    const expected = { role: 'user', content: [{ type: 'text', text: 'hello' }] };
    const actual = buildRunAgentInput({ text: 'hello', images: [] }).message;
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// runAgent — what the transcript shows after an interrupt
// ---------------------------------------------------------------------------

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

class FakeQueryRunner extends IQueryRunner {
  readonly #outcome: QueryOutcome;

  public constructor(outcome: QueryOutcome) {
    super();
    this.#outcome = outcome;
  }

  public async run(): Promise<QueryOutcome> {
    return this.#outcome;
  }
}

function buildConversationState(): ConversationState {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(Clock)
    .using(() => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC))
    .asSelf();
  services
    .register(ILogger)
    .using(() => new NoopLogger())
    .asSelf();
  services.register(ConversationState).asSelf().as(IConversationState);
  return services.buildProvider().resolve(ConversationState);
}

async function runWithOutcome(outcome: QueryOutcome): Promise<ConversationState> {
  const conversationState = buildConversationState();
  const stores = {
    conversationState,
    toolApprovalState: new ToolApprovalState(),
    editorBuffer: buildEditorBuffer(),
    primaryViewState: new PrimaryViewState(),
  };
  await runAgent(new FakeQueryRunner(outcome), { displayText: 'hello world', message: { role: 'user', content: [{ type: 'text', text: 'hello world' }] } }, stores, (_name, output) => output, new AbortController());
  return conversationState;
}

function blockText(state: ConversationState): string {
  return state.sealedBlocks.map((b) => b.content).join('\n');
}

describe('runAgent — interrupt notice', () => {
  it('says the reply was interrupted', async () => {
    const expected = true;
    const state = await runWithOutcome({ interrupted: true, rolledBack: false });
    const actual = blockText(state).includes('Interrupted by user');
    expect(actual).toBe(expected);
  });

  it('says nothing when the query ran to its stop reason', async () => {
    const expected = false;
    const state = await runWithOutcome({ interrupted: false, rolledBack: false });
    const actual = blockText(state).includes('Interrupted by user');
    expect(actual).toBe(expected);
  });

  it('says nothing when the query rolled back, having left nothing behind', async () => {
    const expected = false;
    const state = await runWithOutcome({ interrupted: true, rolledBack: true });
    const actual = blockText(state).includes('Interrupted by user');
    expect(actual).toBe(expected);
  });

  it('takes the rolled-back exchange off the screen', async () => {
    const expected = 0;
    const state = await runWithOutcome({ interrupted: true, rolledBack: true });
    const actual = state.sealedBlocks.length;
    expect(actual).toBe(expected);
  });

  it('leaves an interrupted exchange that kept something on the screen', async () => {
    const expected = true;
    const state = await runWithOutcome({ interrupted: true, rolledBack: false });
    const actual = state.sealedBlocks.length > 0;
    expect(actual).toBe(expected);
  });
});
