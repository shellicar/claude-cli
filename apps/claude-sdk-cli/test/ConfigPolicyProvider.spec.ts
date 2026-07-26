import { IConfigFileReader } from '@shellicar/claude-core/Config/interfaces';
import { IConfigOptions } from '@shellicar/claude-core/Config/IConfigOptions';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { PolicyStore } from '@shellicar/claude-sdk-tools/Policy';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { ConfigPolicyProvider, IPolicyNotifier, readPolicyRaw } from '../src/setup/ConfigPolicyProvider.js';

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

class FakeReader extends IConfigFileReader {
  public constructor(private json: string) {
    super();
  }
  public exists(): boolean {
    return true;
  }
  public read(): string {
    return this.json;
  }
  public setJson(json: string): void {
    this.json = json;
  }
}

const lookup = { get: () => undefined };

function build(initialPolicyJson: string) {
  const reader = new FakeReader(initialPolicyJson);
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IConfigOptions)
    .using(() => ({ paths: ['/sdk-config.json'] }) as unknown as IConfigOptions)
    .asSelf();
  services
    .register(IConfigFileReader)
    .using(() => reader)
    .asSelf();
  services.register(ILogger).using(() => new NoopLogger()).asSelf();
  services
    .register(PolicyStore)
    .using((x) => new PolicyStore(readPolicyRaw(x.resolve(IConfigOptions).paths, x.resolve(IConfigFileReader)), lookup))
    .asSelf();
  services.register(ConfigPolicyProvider).as(IPolicyNotifier);
  const provider = services.buildProvider();
  return { provider, reader, notifier: provider.resolve(IPolicyNotifier), store: provider.resolve(PolicyStore) };
}

describe('readPolicyRaw', () => {
  it('reads the policy field out of the config file', () => {
    const reader = new FakeReader(JSON.stringify({ policy: [{ default: 'deny' }] }));
    const actual = readPolicyRaw(['/sdk-config.json'], reader);
    expect(actual).toEqual([{ default: 'deny' }]);
  });
});

describe('ConfigPolicyProvider.refresh', () => {
  it('does not notify when the file is refreshed with no actual change', () => {
    const { reader, notifier } = build(JSON.stringify({ policy: [{ default: 'ask' }] }));
    const notices: unknown[] = [];
    notifier.onNotice((n) => notices.push(n));

    reader.setJson(JSON.stringify({ policy: [{ default: 'ask' }] }));
    notifier.refresh();

    expect(notices).toEqual([]);
  });

  it('notifies "changed" when the policy content actually differs', () => {
    const { reader, notifier } = build(JSON.stringify({ policy: [{ default: 'ask' }] }));
    const notices: unknown[] = [];
    notifier.onNotice((n) => notices.push(n));

    reader.setJson(JSON.stringify({ policy: [{ default: 'deny' }] }));
    notifier.refresh();

    expect(notices).toEqual([{ kind: 'changed' }]);
  });

  it('notifies "invalid" and keeps the previous policy when the new value fails validation', () => {
    const { reader, notifier, store } = build(JSON.stringify({ policy: [{ default: 'ask' }] }));
    const notices: unknown[] = [];
    notifier.onNotice((n) => notices.push(n));

    reader.setJson(JSON.stringify({ policy: [{ default: 'yolo' }] }));
    notifier.refresh();

    expect(notices).toEqual([{ kind: 'invalid', error: expect.any(String) }]);
    expect(store.current).toEqual([{ default: 'ask' }]);
  });

  it('does not repeat the same invalid notice on a second refresh with the same bad value', () => {
    const { reader, notifier } = build(JSON.stringify({ policy: [{ default: 'ask' }] }));
    reader.setJson(JSON.stringify({ policy: [{ default: 'yolo' }] }));
    const notices: unknown[] = [];
    notifier.onNotice((n) => notices.push(n));

    notifier.refresh();
    notifier.refresh();

    expect(notices.length).toBe(1);
  });

  it('notifies "recovered" when a subsequent edit fixes a previously invalid policy', () => {
    const { reader, notifier } = build(JSON.stringify({ policy: [{ default: 'ask' }] }));
    reader.setJson(JSON.stringify({ policy: [{ default: 'yolo' }] }));
    notifier.refresh();
    const notices: unknown[] = [];
    notifier.onNotice((n) => notices.push(n));

    reader.setJson(JSON.stringify({ policy: [{ default: 'deny' }] }));
    notifier.refresh();

    expect(notices).toEqual([{ kind: 'recovered' }]);
  });
});
