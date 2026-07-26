import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IAgentPresence } from '../src/agent/AgentPresence.js';
import { IAgentServicer } from '../src/agent/AgentServicer.js';
import { IBus } from '../src/bus/IBus.js';
import { IConversationSession } from '../src/model/ConversationSession.js';
import { HistorySweepScheduler } from '../src/persistence/HistorySweepScheduler.js';
import { IShutdownCoordinator } from '../src/setup/ShutdownCoordinator.js';
import { ShutdownSequence } from '../src/setup/ShutdownSequence.js';
import { IWorkingDirectoryMoveHandler } from '../src/setup/WorkingDirectoryMoveHandler.js';
import { TerminalRenderer } from '../src/view/TerminalRenderer.js';

// The observable end of the sequence: how many times the terminal was restored. One clean
// exit restores it once; a second restore means the whole cleanup ran again.
class FakeTerminalRenderer {
  public exits = 0;
  public exit(): void {
    this.exits += 1;
  }
}

class FakeWatchHandle {
  public disposed = false;
  public [Symbol.dispose](): void {
    this.disposed = true;
  }
}

type Built = {
  sequence: ShutdownSequence;
  renderer: FakeTerminalRenderer;
  emitDrain: () => void;
  requestQuit: () => void;
};

function buildShutdownSequence(): Built {
  let drainListener: (() => void) | null = null;
  let requestListener: ((reason: string) => void) | null = null;
  const renderer = new FakeTerminalRenderer();
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(IAgentPresence)
    .using(() => ({ detach: () => {}, stop: () => {}, attach: () => {}, boot: () => {} }) as unknown as IAgentPresence)
    .asSelf();
  services
    .register(IAgentServicer)
    .using(
      () =>
        ({
          on: (event: string, listener: () => void) => {
            if (event === 'drain') {
              drainListener = listener;
            }
          },
        }) as unknown as IAgentServicer,
    )
    .asSelf();
  services
    .register(IBus)
    .using(() => ({ stop: async () => {} }) as unknown as IBus)
    .asSelf();
  services
    .register(IShutdownCoordinator)
    .using(
      () =>
        ({
          onRequest: (listener: (reason: string) => void) => {
            requestListener = listener;
          },
        }) as unknown as IShutdownCoordinator,
    )
    .asSelf();
  services
    .register(TerminalRenderer)
    .using(() => renderer as unknown as TerminalRenderer)
    .asSelf();
  services
    .register(IConversationSession)
    .using(() => ({ id: 'b3c86dc6-5b4e-4b3a-9be4-3f0a4bbfe001' }) as unknown as IConversationSession)
    .asSelf();
  services
    .register(IWorkingDirectoryMoveHandler)
    .using(() => ({ dispose: () => {} }) as unknown as IWorkingDirectoryMoveHandler)
    .asSelf();
  services
    .register(HistorySweepScheduler)
    .using(() => ({ stop: () => {} }) as unknown as HistorySweepScheduler)
    .asSelf();
  services.register(ShutdownSequence).asSelf();
  const sequence = services.buildProvider().resolve(ShutdownSequence);
  return {
    sequence,
    renderer,
    emitDrain: () => drainListener?.(),
    requestQuit: () => requestListener?.('quit'),
  };
}

const PROCESS_EVENTS = ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'] as const;

describe('ShutdownSequence', () => {
  // wire() registers real process listeners and #cleanup reaches process.exit / stdout;
  // stub the process boundary and remove the added listeners so the suite's own process
  // is untouched.
  let priorListeners: Map<string, unknown[]>;

  beforeEach(() => {
    priorListeners = new Map(PROCESS_EVENTS.map((event) => [event, process.listeners(event as 'SIGINT')]));
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const event of PROCESS_EVENTS) {
      const prior = priorListeners.get(event) ?? [];
      for (const listener of process.listeners(event as 'SIGINT')) {
        if (!prior.includes(listener)) {
          process.removeListener(event as 'SIGINT', listener);
        }
      }
    }
  });

  it('runs the cleanup once when two triggers fire', async () => {
    const { sequence, renderer, emitDrain, requestQuit } = buildShutdownSequence();
    sequence.wire();
    // A drain and a keypress quit landing together — two of the four real trigger sources.
    emitDrain();
    requestQuit();
    await new Promise((done) => setImmediate(done));
    const expected = 1;
    const actual = renderer.exits;
    expect(actual).toBe(expected);
  });

  // ConversationBootSequence sets the identity watch only after several awaits; a trigger can already
  // have run #cleanup by the time it lands, and #cleanup never runs again, so nothing else would ever
  // dispose it.
  it('disposes an identity watch set after cleanup has already run', async () => {
    const { sequence, requestQuit } = buildShutdownSequence();
    sequence.wire();
    requestQuit();
    await new Promise((done) => setImmediate(done));
    const handle = new FakeWatchHandle();

    sequence.setIdentityWatch(handle);

    const expected = true;
    const actual = handle.disposed;
    expect(actual).toBe(expected);
  });
});
