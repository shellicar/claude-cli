import { ISleepProvider } from './ISleepProvider';

export class TimeoutSleepProvider extends ISleepProvider {
  public sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const onAbort = () => {
        clearTimeout(handle);
        resolve();
      };
      // {once:true} detaches onAbort when it fires (an abort); the timeout branch
      // detaches it explicitly. Without that, a sleep ending by timeout would leave
      // the listener attached, and a reused signal would pile them up
      // (MaxListenersExceededWarning past 10, plus the retained closures).
      const handle = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
