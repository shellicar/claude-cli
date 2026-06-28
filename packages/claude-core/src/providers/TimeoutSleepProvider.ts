import { ISleepProvider } from './ISleepProvider';

export class TimeoutSleepProvider extends ISleepProvider {
  public sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const handle = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(handle);
          resolve();
        },
        { once: true },
      );
    });
  }
}
