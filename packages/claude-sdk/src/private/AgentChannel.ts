import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { ConsumerMessage, SdkMessage } from '../public/types';

export class AgentChannel {
  readonly #port: MessagePort;
  public readonly consumerPort: MessagePort;

  public constructor(onMessage: (msg: ConsumerMessage) => void) {
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
