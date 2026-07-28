import EventEmitter from 'node:events';
import { dependsOn } from '@shellicar/core-di';
import { IConversationSession } from '../model/ConversationSession.js';
import { IWorkingDirectory } from '../model/WorkingDirectory.js';

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
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  @dependsOn(IWorkingDirectory) private readonly workingDirectory!: IWorkingDirectory;
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
      // A recognised leaf whose body cannot be read carries nothing it needs (agent-spec).
      return encode({ rejected: true, reason: 'invalid', detail: 'body is not valid JSON' });
    }

    if (leaf === 'service') {
      if (req.conversationId == null || req.conversationId === '') {
        return encode({ rejected: true, reason: 'invalid', detail: 'conversationId is missing or empty' });
      }
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
      if (req.conversationId == null || req.conversationId === '' || req.cwd == null || req.cwd === '') {
        return encode({ rejected: true, reason: 'invalid', detail: 'conversationId and cwd are required' });
      }
      if (req.conversationId !== this.session.id) {
        return encode({ rejected: true, reason: 'not_found' });
      }
      // Accept confirms the premise (this world serves the conversation), never the outcome: the move
      // is observed via `attachment.moved` when it lands (agent-spec) — WorkingDirectory's `change`
      // event drives that publish, and a move that never lands just shows as an unchanged cwd.
      this.workingDirectory.change(req.cwd);
      return encode({ accepted: true });
    }

    return encode({ rejected: true, reason: 'unsupported' });
  }
}
