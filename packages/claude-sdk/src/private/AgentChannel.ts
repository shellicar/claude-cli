import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { ConsumerMessage, SdkMessage } from '../public/types';

export abstract class IAgentChannel {
  public abstract get consumerPort(): MessagePort;
  public abstract send(msg: SdkMessage): void;
  public abstract close(): void;
}

export abstract class IAgentChannelFactory {
  public abstract create(onMessage: (msg: ConsumerMessage) => void): IAgentChannel;
}

export class AgentChannel extends IAgentChannel {
  readonly #port: MessagePort;
  public readonly consumerPort: MessagePort;

  public constructor(onMessage: (msg: ConsumerMessage) => void) {
    super();
    const { port1, port2 } = new MessageChannel();
    this.#port = port1;
    this.consumerPort = port2;
    port1.on('message', onMessage);
  }

  public send(msg: SdkMessage): void {
    this.#port.postMessage(msg);
  }

  public close(): void {
    this.#port.close();
  }
}

export class AgentChannelFactory extends IAgentChannelFactory {
  public create(onMessage: (msg: ConsumerMessage) => void): IAgentChannel {
    return new AgentChannel(onMessage);
  }
}
