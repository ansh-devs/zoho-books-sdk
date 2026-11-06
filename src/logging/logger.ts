import { createConsoleLogger, type ConsoleLoggerOptions } from './console-logger.js';
import { bodyPreview, redact, type RedactOptions } from './redact.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Area of the SDK an event comes from. Each can have its own level. */
export type LogCategory = 'http' | 'auth' | 'gst' | 'workflow';

export type LogFields = Record<string, unknown>;

/** Logger shape the SDK writes to. Winston and console fit it as is; Pino fits through fromPino. */
export interface ZohoLogger {
  trace?(msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child?(bindings: LogFields): ZohoLogger;
}

/** Pino and Bunyan style logger, which takes fields first and the message second. */
export interface PinoLike {
  trace(fields: object, msg?: string): void;
  debug(fields: object, msg?: string): void;
  info(fields: object, msg?: string): void;
  warn(fields: object, msg?: string): void;
  error(fields: object, msg?: string): void;
  child(bindings: object): PinoLike;
  level?: string;
}

export interface LoggingOptions {
  /** Lowest level written. Default: ZOHO_BOOKS_LOG_LEVEL, else your logger's own level, else warn. */
  level?: LogLevel;
  /** Level per category, e.g. { http: 'debug' }. */
  levels?: Partial<Record<LogCategory, LogLevel>>;
  redact?: RedactOptions;
  /** Request and response bodies in logs: none (default), errors, or all. Always redacted. */
  bodies?: 'none' | 'errors' | 'all';
  /** Longest body text kept, in characters. Default 2000. */
  maxBodyLength?: number;
  /** Fields added to every event, e.g. the active trace id. */
  context?: () => LogFields;
  /** Built in logger only: json (default, Pino compatible) or pretty. ZOHO_BOOKS_LOG_FORMAT also sets it. */
  format?: ConsoleLoggerOptions['format'];
  /** Built in logger only: where lines go. Default process.stderr. */
  destination?: ConsoleLoggerOptions['destination'];
}

const LEVELS: Record<Exclude<LogLevel, 'silent'>, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
const LEVEL_ALIASES: Record<string, LogLevel> = { fatal: 'error', verbose: 'debug', http: 'debug', silly: 'trace' };

function toLevel(value: unknown): LogLevel | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.toLowerCase();
  if (v === 'silent' || v in LEVELS) return v as LogLevel;
  return LEVEL_ALIASES[v];
}

/** True for a Pino or Bunyan instance, which take fields before the message. */
export function isPinoLike(logger: unknown): logger is PinoLike {
  const l = logger as Record<string, unknown> | null;
  return (
    !!l &&
    typeof l.child === 'function' &&
    typeof l.info === 'function' &&
    (typeof l.bindings === 'function' || typeof l.addStream === 'function') &&
    typeof l.levels === 'object'
  );
}

/** Adapt a Pino or Bunyan logger to the SDK's message first shape. */
export function fromPino(logger: PinoLike): ZohoLogger & { level?: string } {
  return {
    level: logger.level,
    trace: (msg, fields) => logger.trace(fields ?? {}, msg),
    debug: (msg, fields) => logger.debug(fields ?? {}, msg),
    info: (msg, fields) => logger.info(fields ?? {}, msg),
    warn: (msg, fields) => logger.warn(fields ?? {}, msg),
    error: (msg, fields) => logger.error(fields ?? {}, msg),
    child: (bindings) => fromPino(logger.child(bindings)),
  };
}

interface Resolved {
  level: number;
  levels: Partial<Record<LogCategory, number>>;
  redact: RedactOptions;
  bodies: 'none' | 'errors' | 'all';
  maxBodyLength: number;
  context: (() => LogFields) | undefined;
}

/** The SDK's internal logger: filters by level, redacts, adds context and never throws into a request. */
export class SdkLogger {
  constructor(
    private readonly sink: ZohoLogger | undefined,
    private readonly settings: Resolved,
    private readonly bindings: LogFields = {},
  ) {}

  /** A logger that writes nothing. */
  static silent(): SdkLogger {
    return new SdkLogger(undefined, { level: Infinity, levels: {}, redact: {}, bodies: 'none', maxBodyLength: 0, context: undefined });
  }

  get bodies(): 'none' | 'errors' | 'all' {
    return this.settings.bodies;
  }

  /** Whether an event at this level and category would be written. Check it before building costly fields. */
  enabled(level: Exclude<LogLevel, 'silent'>, category: LogCategory): boolean {
    return !!this.sink && LEVELS[level] >= (this.settings.levels[category] ?? this.settings.level);
  }

  /** Redacted, truncated copy of a body for a log field. */
  body(body: unknown): unknown {
    return bodyPreview(body, this.settings.redact, this.settings.maxBodyLength);
  }

  log(level: Exclude<LogLevel, 'silent'>, category: LogCategory, event: string, msg: string, fields?: LogFields | (() => LogFields)): void {
    if (!this.enabled(level, category)) return;
    try {
      const data = typeof fields === 'function' ? fields() : fields;
      const merged = { event, category, ...this.bindings, ...this.settings.context?.(), ...data };
      const safe = redact(merged, this.settings.redact) as LogFields;
      const sink = this.sink!;
      const write = level === 'trace' ? (sink.trace ?? sink.debug) : sink[level];
      write.call(sink, msg, safe);
    } catch {
      // A failing logger must never break an API call.
    }
  }

  trace(category: LogCategory, event: string, msg: string, fields?: LogFields | (() => LogFields)): void {
    this.log('trace', category, event, msg, fields);
  }
  debug(category: LogCategory, event: string, msg: string, fields?: LogFields | (() => LogFields)): void {
    this.log('debug', category, event, msg, fields);
  }
  info(category: LogCategory, event: string, msg: string, fields?: LogFields | (() => LogFields)): void {
    this.log('info', category, event, msg, fields);
  }
  warn(category: LogCategory, event: string, msg: string, fields?: LogFields | (() => LogFields)): void {
    this.log('warn', category, event, msg, fields);
  }
  error(category: LogCategory, event: string, msg: string, fields?: LogFields | (() => LogFields)): void {
    this.log('error', category, event, msg, fields);
  }

  /** Logger that adds these fields to every event. Uses the sink's own child when it has one. */
  child(bindings: LogFields): SdkLogger {
    if (this.sink?.child) {
      try {
        return new SdkLogger(this.sink.child(redact(bindings, this.settings.redact) as LogFields), this.settings, {});
      } catch {
        // Fall back to merging bindings ourselves.
      }
    }
    return new SdkLogger(this.sink, this.settings, { ...this.bindings, ...bindings });
  }
}

const env = (name: string): string | undefined => (typeof process !== 'undefined' ? process.env?.[name] : undefined) || undefined;

/** Build the SDK logger. undefined uses the built in JSON logger, false is silent, anything else is your logger. */
export function createSdkLogger(logger: ZohoLogger | PinoLike | false | undefined, options: LoggingOptions = {}): SdkLogger {
  if (logger === false) return SdkLogger.silent();
  const sink: ZohoLogger =
    logger === undefined
      ? createConsoleLogger({
          format: options.format ?? (env('ZOHO_BOOKS_LOG_FORMAT') === 'pretty' ? 'pretty' : 'json'),
          ...(options.destination ? { destination: options.destination } : {}),
        })
      : isPinoLike(logger)
        ? fromPino(logger)
        : (logger as ZohoLogger);

  const sinkLevel = logger === undefined ? undefined : toLevel((sink as { level?: unknown }).level);
  const base = options.level ?? toLevel(env('ZOHO_BOOKS_LOG_LEVEL')) ?? sinkLevel ?? 'warn';
  const num = (l: LogLevel) => (l === 'silent' ? Infinity : LEVELS[l]);
  const levels: Partial<Record<LogCategory, number>> = {};
  for (const [cat, l] of Object.entries(options.levels ?? {}) as [LogCategory, LogLevel][]) levels[cat] = num(l);

  return new SdkLogger(sink, {
    level: num(base),
    levels,
    redact: options.redact ?? {},
    bodies: options.bodies ?? 'none',
    maxBodyLength: options.maxBodyLength ?? 2000,
    context: options.context,
  });
}
