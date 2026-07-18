import EventEmitter from 'node:events';
import { dependsOn } from '@shellicar/core-di-lite';
import { ConversationSession } from '../model/ConversationSession.js';
import { WorkingDirectory } from '../model/WorkingDirectory.js';

const encode = (body: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(body));

type AgentServicerEvents = {
  /** Fired once a `drain` request is accepted \u2014 main.ts wires this to the same clean-shutdown path SIGTERM uses. */
  drain: [];
};

/** The addressable face's contract; register abstract\u2192concrete and depend on the abstract (DI rule). */
export abstract class IAgentServicer {
  public abstract on<K extends keyof AgentServicerEvents>(event: K, listener: (...args: AgentServicerEvents[K]) => void): void;
  public abstract handle(payload: Uint8Array, subject: string): Uint8Array;
}

/**
 * The addressable face of the world, serving `agent.v1.{world}.requests.*`. This process is one instance
 * serving exactly one conversation at a time (a run is process + conversation, per ConversationSession) \u2014
 * `service` for that conversation confirms it (`already_attached`); `service` for any other conversation
 * id is honestly `unsupported` (this build cannot spawn or take over an arbitrary second conversation).
 * `chdir` reconciles this instance's one live attachment; `drain` fires the same clean-shutdown path a
 * decided Ctrl-C uses. Every request owes a reply \u2014 compliance is answering, not implementing.
 */
export class AgentServicer extends IAgentServicer {
  @dependsOn(ConversationSession) private readonly session!: ConversationSession;
  @dependsOn(WorkingDirectory) private readonly workingDirectory!: WorkingDirectory;
  readonly #emitter = new EventEmitter<AgentServicerEvents>();

  public on<K extends keyof AgentServicerEvents>(event: K, listener: (...args: AgentServicerEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public handle(payload: Uint8Array, subject: string): Uint8Array {
    const leaf = subject.split('.').at(-1);
    let req: { conversationId?: string; cwd?: string };
    try {
      req = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return encode({ rejected: true, reason: 'unsupported' });
    }

    if (leaf === 'service') {
      if (req.conversationId === this.session.id) {
        return encode({ rejected: true, reason: 'already_attached' });
      }
      // No spawn/resume/takeover path in this build: it serves the one conversation it was launched for.
      return encode({ rejected: true, reason: 'unsupported' });
    }

    if (leaf === 'drain') {
      this.#emitter.emit('drain');
      return encode({ accepted: true });
    }

    if (leaf === 'chdir') {
      if (req.conversationId !== this.session.id || req.cwd == null) {
        return encode({ rejected: true, reason: 'not_found' });
      }
      // Accept confirms the premise, never the outcome: the move is observed via a re-published
      // `attached` when it lands (agent-spec) \u2014 WorkingDirectory's `change` event drives that re-publish.
      this.workingDirectory.change(req.cwd);
      return encode({ accepted: true });
    }

    return encode({ rejected: true, reason: 'unsupported' });
  }
}
