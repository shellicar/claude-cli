import type winston from 'winston';
import { addColors, createLogger, format, transports } from 'winston';

const levels = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
const colors = { error: 'red', warn: 'yellow', info: 'green', debug: 'blue', trace: 'gray' };

addColors(colors);

const MAX_LENGTH = 512;


function truncateString(value: string): string {
  return value.length <= MAX_LENGTH ? value : `${value.slice(0, MAX_LENGTH)}...`;
}

function truncate<T>(value: T): T {
  if (typeof value === 'string') {
    return truncateString(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(truncate) as T;
  }
  if (value !== null && typeof value === 'object') {
    try {
      // Use JSON.stringify/parse to capture non-enumerable and prototype properties
      const plain = JSON.parse(JSON.stringify(value));
      return Object.fromEntries(Object.entries(plain).map(([k, v]) => [k, truncate(v)])) as T;
    } catch {
      return String(value) as T;
    }
  }
  return value;
}

const truncateFormat = format((info) => {
  const { level, message, timestamp, ...meta } = info;
  const truncated = truncate(meta);
  for (const [key, value] of Object.entries(truncated)) {
    info[key] = value;
  }
  return info;
});

const printfFormat = format.printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} ${level}: ${message}${metaStr}`;
});

export const logger = createLogger({
  levels,
  level: 'trace',
  format: format.combine(format.timestamp({ format: 'HH:mm:ss' }), truncateFormat(MAX_LENGTH)),
  transports: [new transports.File({ filename: 'claude-sdk-cli.log', format: printfFormat }), new transports.Console({ level: 'debug', format: format.combine(format.colorize(), printfFormat) })],
}) as winston.Logger & { trace: winston.LeveledLogMethod };
