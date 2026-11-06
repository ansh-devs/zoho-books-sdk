import { hostname } from 'node:os';
import type { LogFields, ZohoLogger } from './logger.js';

export interface ConsoleLoggerOptions {
  /** json writes one Pino compatible object per line. pretty writes a readable line for development. */
  format?: 'json' | 'pretty';
  /** Where lines go. Default process.stderr. */
  destination?: { write(chunk: string): unknown };
  /** name field on every line. Defaults to the package name. */
  name?: string;
}

const NUMERIC = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 } as const;
type Level = keyof typeof NUMERIC;

function formatValue(v: unknown): string {
  if (typeof v === 'string') return /\s/.test(v) ? JSON.stringify(v) : v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Built in logger with no dependencies. Filtering and redaction happen before it is called. */
export function createConsoleLogger(options: ConsoleLoggerOptions = {}): ZohoLogger {
  const dest = options.destination ?? process.stderr;
  const name = options.name ?? 'zoho-books-sdk';
  const pid = process.pid;
  const host = hostname();

  const write = (level: Level, msg: string, fields: LogFields = {}) => {
    let line: string;
    if (options.format === 'pretty') {
      const { event, category: _c, ...rest } = fields;
      const pairs = Object.entries(rest)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(' ');
      line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${String(event ?? '')} ${msg}${pairs ? ` ${pairs}` : ''}\n`;
    } else {
      line = `${JSON.stringify({ level: NUMERIC[level], time: Date.now(), pid, hostname: host, name, msg, ...fields })}\n`;
    }
    dest.write(line);
  };

  return {
    trace: (msg, fields) => write('trace', msg, fields),
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}
