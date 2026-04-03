import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { ConsumerMessage, SdkMessage } from '../public/types';

export class AgentChannel {
  readonly #port: MessagePort;
  readonly consumerPort: MessagePort;

  constructor(onMessage: (msg: ConsumerMessage) => void) {
    const { port1, port2 } = new MessageChannel();
    this.#port = port1;
    this.consumerPort = port2;
    port1.on('message', onMessage);
  }

  send(msg: SdkMessage): void {
    this.#port.postMessage(msg);
  }

  close(): void {
    this.#port.close();
  }
}
