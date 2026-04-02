import type winston from 'winston';
import { addColors, createLogger, format, transports } from 'winston';

const levels = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
const colors = { error: 'red', warn: 'yellow', info: 'green', debug: 'blue', trace: 'gray' };

addColors(colors);

const MAX_LENGTH = 512;

function truncate<T>(value: T): T {
  if (typeof value === 'string') {
    if (value.length <= MAX_LENGTH) {
      return value;
    }
    return `${value.slice(0, MAX_LENGTH)}...` as T;
  }
  if (Array.isArray(value)) {
    return value.map(truncate) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncate(v)])) as T;
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

export const logger = createLogger({
  levels,
  level: 'debug',
  format: format.combine(
    format.timestamp({ format: 'HH:mm:ss' }),
    truncateFormat(MAX_LENGTH),
    format.colorize(),
    format.printf(({ level, message, timestamp, ...meta }) => {
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} ${level}: ${message}${metaStr}`;
    }),
  ),
  transports: [new transports.Console()],
}) as winston.Logger & { trace: winston.LeveledLogMethod };
