import type { SdkMessage } from './types';

/**
 * The outbound SDK-message publisher contract. `QueryRunner` sends on it; the
 * consumer's channel implements it. A non-generic abstract class so it can be
 * a core-di-lite injection identifier (the generic `IPublisher<T>` cannot).
 */
export abstract class ISdkMessagePublisher {
  public abstract send(msg: SdkMessage): void;
  public abstract close(): void;
  public abstract drain(): Promise<void>;
}
