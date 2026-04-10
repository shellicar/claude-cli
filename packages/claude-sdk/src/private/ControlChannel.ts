import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { ConsumerMessage, SdkMessage } from '../public/types';

export abstract class IControlChannel {
  public abstract get consumerPort(): MessagePort;
  public abstract send(msg: SdkMessage): void;
  public abstract on(event: 'message', listener: (msg: ConsumerMessage) => void): void;
  public abstract close(): void;
}

export class ControlChannel extends IControlChannel {
  readonly #port: MessagePort;
  public readonly consumerPort: MessagePort;

  public constructor() {
    super();
    const { port1, port2 } = new MessageChannel();
    this.#port = port1;
    this.consumerPort = port2;
  }

  public send(msg: SdkMessage): void {
    this.#port.postMessage(msg);
  }

  public on(_event: 'message', listener: (msg: ConsumerMessage) => void): void {
    this.#port.on('message', listener);
  }

  public close(): void {
    this.#port.close();
  }
}
