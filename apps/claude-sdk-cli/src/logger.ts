import type winston from 'winston';
import { addColors, createLogger, format, transports } from 'winston';

const levels = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
const colors = { error: 'red', warn: 'yellow', info: 'green', debug: 'blue', trace: 'gray' };

addColors(colors);

const consoleFormat = format.printf(({ level, message, timestamp, data, ...meta }) => {
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} ${level}: ${message}${dataStr}${metaStr}`;
});

const winstonLogger = createLogger({
  levels,
  level: 'trace',
  format: format.combine(format.timestamp({ format: 'HH:mm:ss' })),
  transports: [new transports.File({ filename: 'claude-sdk-cli.log', format: format.json() }), new transports.Console({ level: 'debug', format: format.combine(format.colorize(), consoleFormat) })],
}) as winston.Logger & { trace: winston.LeveledLogMethod };

const wrapMeta = (meta: unknown[]): object => (meta.length === 0 ? {} : meta.length === 1 ? { data: meta[0] } : { data: meta });

export const logger = {
  trace: (message: string, ...meta: unknown[]) => winstonLogger.trace(message, wrapMeta(meta)),
  debug: (message: string, ...meta: unknown[]) => winstonLogger.debug(message, wrapMeta(meta)),
  info: (message: string, ...meta: unknown[]) => winstonLogger.info(message, wrapMeta(meta)),
  warn: (message: string, ...meta: unknown[]) => winstonLogger.warn(message, wrapMeta(meta)),
  error: (message: string, ...meta: unknown[]) => winstonLogger.error(message, wrapMeta(meta)),
};
