import { type CallbackListener, ICallbackListener } from './interfaces';
import { nodeHttpServerFactory, startCallbackListener } from './startCallbackListener';

export class HttpCallbackListener extends ICallbackListener {
  public start(): Promise<CallbackListener> {
    return startCallbackListener(nodeHttpServerFactory);
  }
}
