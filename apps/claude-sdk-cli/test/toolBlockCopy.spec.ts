import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { hitTest } from '../src/model/ClickRegion.js';
import { ConversationState, IConversationState } from '../src/model/ConversationState.js';
import type { ToolEntry } from '../src/model/ToolObject.js';
import { renderConversationFrame } from '../src/view/renderConversation.js';

const NOW = Instant.parse('2026-08-11T00:00:00Z');

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

function buildConversationState(): IConversationState {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services.register(NoopLogger).as(ILogger);
  services
    .register(Clock)
    .using(() => Clock.fixed(NOW, ZoneId.UTC))
    .asSelf();
  services.register(ConversationState).as(IConversationState);
  return services.buildProvider().resolve(IConversationState);
}

const entry = (output: string | null): ToolEntry => ({ name: 'ExecV3', kind: 'client', input: { intent: 'look' }, output, phase: output === null ? 'running' : 'ok' });

/**
 * The order AgentMessageHandler drives: the use block is opened and filled while the
 * call is generated, sealed when the message completes, then the execution block is
 * opened and refilled from the same tool objects as each call settles.
 */
function afterOneToolRoundTrip(): IConversationState {
  const state = buildConversationState();
  state.transitionBlock('tools');
  state.setLastTools('tools', '\u2192 ExecV3', [entry(null)]);
  state.completeActive();
  state.transitionBlock('execution');
  state.setLastTools('execution', '\u2192 ExecV3', [entry('done')]);
  state.completeActive();
  return state;
}

describe('the two sides of a tool round trip copy different things', () => {
  it('gives the use block and the execution block one affordance each', () => {
    const expected = 2;
    const actual = renderConversationFrame(afterOneToolRoundTrip(), 80).regions.length;
    expect(actual).toBe(expected);
  });

  it('copies the invocation from the use block', () => {
    const expected = JSON.stringify([{ name: 'ExecV3', input: { intent: 'look' } }], null, 2);
    const actual = renderConversationFrame(afterOneToolRoundTrip(), 80).regions[0]?.text;
    expect(actual).toBe(expected);
  });

  it('copies the result from the execution block', () => {
    const expected = JSON.stringify([{ name: 'ExecV3', output: 'done' }], null, 2);
    const actual = renderConversationFrame(afterOneToolRoundTrip(), 80).regions[1]?.text;
    expect(actual).toBe(expected);
  });

  it('puts the two affordances on different rows', () => {
    const frame = renderConversationFrame(afterOneToolRoundTrip(), 80);
    const expected = true;
    const actual = frame.regions[0]?.row !== frame.regions[1]?.row;
    expect(actual).toBe(expected);
  });

  it('puts each affordance on the row of the header it belongs to', () => {
    const frame = renderConversationFrame(afterOneToolRoundTrip(), 80);
    const expected = [true, true];
    const actual = frame.regions.map((region) => (frame.lines[region.row] ?? '').includes('\u29c9'));
    expect(actual).toEqual(expected);
  });

  it('resolves a click on each affordance to that block', () => {
    const frame = renderConversationFrame(afterOneToolRoundTrip(), 80);
    const expected = frame.regions.map((region) => region.text);
    const actual = frame.regions.map((region) => hitTest(frame.regions, region.startCol, region.row)?.text);
    expect(actual).toEqual(expected);
  });
});
