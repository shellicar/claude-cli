import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { ConversationState, IConversationState } from '../src/model/ConversationState.js';

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

/** ConversationState injects Clock and ILogger; built with `new` it has neither, and the streaming paths read both. */
export function buildConversationState(clock: Clock = Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC)): ConversationState {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(Clock)
    .using(() => clock)
    .asSelf();
  services
    .register(ILogger)
    .using(() => new NoopLogger())
    .asSelf();
  services.register(ConversationState).asSelf().as(IConversationState);
  return services.buildProvider().resolve(ConversationState);
}
