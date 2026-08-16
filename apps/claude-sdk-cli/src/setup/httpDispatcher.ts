import diagnostics_channel from 'node:diagnostics_channel';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { Agent } from 'undici';

type ConnectedEvent = { socket?: { alpnProtocol?: string | false; servername?: string } };

/** Logs the protocol each connection negotiates, because it is otherwise invisible: undici 8 (Node 26) enables HTTP/2 by default, where an over-limit request is reset with an opaque stream error carrying no status instead of a readable 413. */
export const createHttpDispatcher = (allowH2: boolean, logger: ILogger): Agent => {
  diagnostics_channel.subscribe('undici:client:connected', (event) => {
    const socket = (event as ConnectedEvent)?.socket;
    logger.info('connection established', { alpn: socket?.alpnProtocol || 'http/1.1', host: socket?.servername ?? null, allowH2 });
  });
  return new Agent({ allowH2 });
};
