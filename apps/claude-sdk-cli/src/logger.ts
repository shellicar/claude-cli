import winston from 'winston';
import { redact } from './redact';

const levels = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
const colors = { error: 'red', warn: 'yellow', info: 'green', debug: 'blue', trace: 'gray' };

winston.addColors(colors);

const truncateStrings = (value: unknown, max: number): unknown => {
  if (typeof value === 'string') {
    return value.length > max ? `${value.slice(0, max)}...` : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => truncateStrings(item, max));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncateStrings(v, max)]));
  }
  return value;
};

const summariseLarge = (value: unknown, max: number): unknown => {
  const s = JSON.stringify(value);
  if (s.length <= max) {
    return value;
  }
  if (Array.isArray(value)) {
    return { '[truncated]': true, bytes: s.length, length: value.length };
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, summariseLarge(v, max)]));
  }
  if (typeof value === 'string') {
    return `${value.slice(0, max)}...`;
  }
  return value;
};

const fileFormat = (max: number) =>
  winston.format.printf((info) => {
    const parsed = JSON.parse(JSON.stringify(info));
    if (parsed.data !== undefined) {
      parsed.data = summariseLarge(parsed.data, max);
    }
    return JSON.stringify(truncateStrings(parsed, max));
  });

// const consoleFormat = winston.format.printf(({ level, message, timestamp, data, ...meta }) => {
//   const dataStr = data !== undefined ? ` ${JSON.stringify(summariseLarge(data, 2000))}` : '';
//   const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
//   return `${timestamp} ${level}: ${message}${dataStr}${metaStr}`;
// });

const transports: winston.transport[] = [];
transports.push(new winston.transports.File({ filename: 'claude-sdk-cli.log', format: fileFormat(200) }));
// transports.push(new winston.transports.Console({ level: 'debug', format: winston.format.combine(winston.format.colorize(), consoleFormat) }));

const winstonLogger = winston.createLogger({
  levels,
  level: 'trace',
  format: winston.format.combine(winston.format.timestamp({ format: 'HH:mm:ss' })),
  transports,
}) as winston.Logger & { trace: winston.LeveledLogMethod };

const wrapMeta = (meta: unknown[]): object => {
  const wrapped = meta.length === 0 ? {} : meta.length === 1 ? { data: meta[0] } : { data: meta };
  return redact(wrapped) as object;
};

export const logger = {
  trace: (message: string, ...meta: unknown[]) => winstonLogger.trace(message, wrapMeta(meta)),
  debug: (message: string, ...meta: unknown[]) => winstonLogger.debug(message, wrapMeta(meta)),
  info: (message: string, ...meta: unknown[]) => winstonLogger.info(message, wrapMeta(meta)),
  warn: (message: string, ...meta: unknown[]) => winstonLogger.warn(message, wrapMeta(meta)),
  error: (message: string, ...meta: unknown[]) => winstonLogger.error(message, wrapMeta(meta)),
};
