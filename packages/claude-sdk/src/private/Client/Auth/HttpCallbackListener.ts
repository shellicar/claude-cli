import { ISleepProvider } from '@shellicar/claude-core/providers/ISleepProvider';
import { dependsOn } from '@shellicar/core-di';
import { type CallbackListener, ICallbackListener } from './interfaces';
import { nodeHttpServerFactory, startCallbackListener } from './startCallbackListener';

export class HttpCallbackListener extends ICallbackListener {
  @dependsOn(ISleepProvider) private readonly sleeper!: ISleepProvider;

  public start(): Promise<CallbackListener> {
    return startCallbackListener(nodeHttpServerFactory, this.sleeper);
  }
}
