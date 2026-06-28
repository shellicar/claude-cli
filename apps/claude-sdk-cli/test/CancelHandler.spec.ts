import type { ConsumerMessage } from '@shellicar/claude-sdk';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { CancelHandler } from '../src/controller/CancelHandler.js';
import { ConsumerChannel } from '../src/setup/ConsumerChannel.js';

// Records the messages the handler sends, so escape's cancel can be asserted
// directly off state without driving the channel's async delivery.
class RecordingConsumerChannel extends ConsumerChannel {
  public readonly sent: ConsumerMessage[] = [];
  public override send(msg: ConsumerMessage): void {
    this.sent.push(msg);
  }
}

// CancelHandler injects ConsumerChannel, so build it through a container.
function buildCancelHandler(channel: ConsumerChannel): CancelHandler {
  const services = createServiceCollection();
  services.register(ConsumerChannel).to(ConsumerChannel, () => channel);
  services.register(CancelHandler).to(CancelHandler);
  return services.buildProvider().resolve(CancelHandler);
}

describe('CancelHandler', () => {
  it('sends a cancel on escape', () => {
    const channel = new RecordingConsumerChannel();
    const handler = buildCancelHandler(channel);
    handler.handleKey({ type: 'escape' });
    const expected: ConsumerMessage[] = [{ type: 'cancel' }];
    const actual = channel.sent;
    expect(actual).toEqual(expected);
  });

  it('claims the escape key', () => {
    const handler = buildCancelHandler(new RecordingConsumerChannel());
    const expected = true;
    const actual = handler.handleKey({ type: 'escape' });
    expect(actual).toBe(expected);
  });

  it('passes through a non-escape key', () => {
    const handler = buildCancelHandler(new RecordingConsumerChannel());
    const expected = false;
    const actual = handler.handleKey({ type: 'char', value: 'x' });
    expect(actual).toBe(expected);
  });
});
