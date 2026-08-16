import diagnostics_channel from 'node:diagnostics_channel';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { Agent } from 'undici';

type ConnectedEvent = { socket?: { alpnProtocol?: string | false; servername?: string } };

/** The negotiated protocol is not otherwise observable, so each connection logs it. */
export const createHttpDispatcher = (allowH2: boolean, logger: ILogger): Agent => {
  diagnostics_channel.subscribe('undici:client:connected', (event) => {
    const socket = (event as ConnectedEvent)?.socket;
    logger.info('connection established', { alpn: socket?.alpnProtocol || 'http/1.1', host: socket?.servername ?? null, allowH2 });
  });
  return new Agent({ allowH2 });
};
