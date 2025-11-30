/**
 * Structured logging utility for production-grade observability
 *
 * Provides JSON-formatted logs compatible with Cloudflare Workers logging
 * and log aggregation services.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  /** Request ID for correlation */
  requestId?: string;
  /** User ID or subject */
  userId?: string;
  /** HTTP method */
  method?: string;
  /** Request path */
  path?: string;
  /** Response status code */
  status?: number;
  /** Response time in milliseconds */
  duration?: number;
  /** Error details */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  /** Additional custom fields */
  [key: string]: unknown;
}

interface LogEntry {
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** ISO timestamp */
  timestamp: string;
  /** Service name */
  service: string;
  /** Additional context */
  context?: LogContext;
}

/**
 * Logger configuration
 */
interface LoggerConfig {
  /** Minimum log level to output */
  minLevel: LogLevel;
  /** Service name */
  service: string;
  /** Whether to use JSON format (true for production) */
  jsonFormat: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      minLevel: config.minLevel || "info",
      service: config.service || "toiletmap-api",
      jsonFormat: config.jsonFormat ?? true,
    };
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  /**
   * Format and output a log entry
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      service: this.config.service,
      context,
    };

    if (this.config.jsonFormat) {
      // JSON format for production (easier to parse and query)
      const output = JSON.stringify(entry);

      // Use appropriate console method for visibility
      if (level === "error") {
        console.error(output);
      } else if (level === "warn") {
        console.warn(output);
      } else {
        console.log(output);
      }
    } else {
      // Human-readable format for development
      const contextStr = context ? ` ${JSON.stringify(context)}` : "";
      const output = `[${entry.timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`;

      if (level === "error") {
        console.error(output);
      } else if (level === "warn") {
        console.warn(output);
      } else {
        console.log(output);
      }
    }
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: LogContext): void {
    this.log("debug", message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: LogContext): void {
    this.log("info", message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: LogContext): void {
    this.log("warn", message, context);
  }

  /**
   * Log an error message
   */
  error(message: string, context?: LogContext): void {
    this.log("error", message, context);
  }

  /**
   * Log an error object with full details
   */
  logError(error: Error, context?: LogContext): void {
    this.error(error.message, {
      ...context,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: LogContext): Logger {
    const childLogger = new Logger(this.config);
    const originalLog = childLogger.log.bind(childLogger);

    childLogger.log = (level: LogLevel, message: string, context?: LogContext) => {
      originalLog(level, message, { ...additionalContext, ...context });
    };

    return childLogger;
  }
}

/**
 * Create a logger instance based on environment
 */
export function createLogger(env?: "production" | "preview" | "development"): Logger {
  // Treat preview as production for logging purposes
  const isProduction = env === "production" || env === "preview";

  return new Logger({
    minLevel: isProduction ? "info" : "debug",
    service: "toiletmap-api",
    jsonFormat: isProduction,
  });
}

/**
 * Default logger instance
 */
export const logger = createLogger();
