import { pino } from 'pino';

// Accept Python-style level names too, so LOG_LEVEL is interchangeable with provider-ytdl.
const LEVEL_ALIASES: Record<string, string> = { warning: 'warn', critical: 'fatal' };
const rawLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const level = LEVEL_ALIASES[rawLevel] ?? rawLevel;

// Field names mirror provider-ytdl (structlog): level, ts, service, msg, plus
// per-request method/path/status/duration_ms/id.
export const logger = pino({
  level,
  base: { service: 'youtubejs' },
  messageKey: 'msg',
  timestamp: () => `,"ts":"${new Date().toISOString()}"`,
  formatters: {
    level: (label: string) => ({ level: label }),
  },
});
