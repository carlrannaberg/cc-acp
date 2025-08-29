import { z } from 'zod';

// Error message validation schema
export const ErrorMessageSchema = z.object({
  code: z.number(),
  message: z.string().min(1).max(1000),
  data: z.object({
    details: z.unknown().optional(),
    stack: z.string().optional(),
    retryAfter: z.number().positive().optional(),
    authUrl: z.string().url().optional(),
    path: z.string().optional(),
    timestamp: z.string().datetime().optional(),
    correlationId: z.string().optional()
  }).optional()
}).strict();

export type ValidatedErrorMessage = z.infer<typeof ErrorMessageSchema>;

export interface ErrorData {
  details?: unknown;
  stack?: string;
  retryAfter?: number;
  authUrl?: string;
  path?: string;
  timestamp?: string;
  correlationId?: string;
  originalError?: ACPError;
}

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBase: number;
  jitter: boolean;
  retryCondition?: (error: ACPError) => boolean;
}

export interface RecoveryContext {
  attempt: number;
  lastError: ACPError;
  metadata?: Record<string, unknown>;
}

export interface RecoveryResult {
  success: boolean;
  data?: unknown;
  error?: ACPError;
  retryAfter?: number;
}

export interface RecoveryStrategy {
  name: string;
  canHandle(error: ACPError): boolean;
  execute(error: ACPError, context?: RecoveryContext): Promise<RecoveryResult>;
}

export interface ACPError {
  code: number;
  message: string;
  data?: ErrorData;
}

export class ClaudeSDKError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
    public authUrl?: string
  ) {
    super(message);
    this.name = 'ClaudeSDKError';
  }
}

export class ErrorLogger {
  private static instance: ErrorLogger;
  private correlationIdCounter = 0;

  static getInstance(): ErrorLogger {
    if (!ErrorLogger.instance) {
      ErrorLogger.instance = new ErrorLogger();
    }
    return ErrorLogger.instance;
  }

  generateCorrelationId(): string {
    return `err_${Date.now()}_${++this.correlationIdCounter}`;
  }

  private formatLogMessage(level: LogLevel, message: string, error?: ACPError, metadata?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...(error && {
        error: {
          code: error.code,
          message: error.message,
          data: error.data
        }
      }),
      ...(metadata && { metadata })
    };
    return JSON.stringify(logEntry);
  }

  logError(message: string, error?: ACPError, metadata?: Record<string, unknown>): void {
    console.error(this.formatLogMessage(LogLevel.ERROR, message, error, metadata));
  }

  logWarning(message: string, error?: ACPError, metadata?: Record<string, unknown>): void {
    console.warn(this.formatLogMessage(LogLevel.WARN, message, error, metadata));
  }

  logInfo(message: string, metadata?: Record<string, unknown>): void {
    console.info(this.formatLogMessage(LogLevel.INFO, message, undefined, metadata));
  }

  logDebug(message: string, metadata?: Record<string, unknown>): void {
    if (process.env.DEBUG) {
      console.debug(this.formatLogMessage(LogLevel.DEBUG, message, undefined, metadata));
    }
  }

  log(level: LogLevel, message: string, error?: ACPError, metadata?: Record<string, unknown>): void {
    switch (level) {
      case LogLevel.ERROR:
        this.logError(message, error, metadata);
        break;
      case LogLevel.WARN:
        this.logWarning(message, error, metadata);
        break;
      case LogLevel.INFO:
        this.logInfo(message, metadata);
        break;
      case LogLevel.DEBUG:
        this.logDebug(message, metadata);
        break;
    }
  }
}

export class RetryHandler {
  private static readonly DEFAULT_POLICY: RetryPolicy = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    exponentialBase: 2,
    jitter: true,
    retryCondition: (error: ACPError) => this.isRetryableError(error)
  };

  private logger = ErrorLogger.getInstance();

  constructor(private policy: Partial<RetryPolicy> = {}) {
    this.policy = { ...RetryHandler.DEFAULT_POLICY, ...policy };
  }

  private static isRetryableError(error: ACPError): boolean {
    // Rate limits and temporary server errors are retryable
    return error.code === 429 || 
           (error.code >= -32099 && error.code <= -32000) ||
           error.code === -32603; // Internal error
  }

  private calculateDelay(attempt: number): number {
    const policy = this.policy as RetryPolicy;
    let delay = policy.baseDelay * Math.pow(policy.exponentialBase, attempt - 1);
    delay = Math.min(delay, policy.maxDelay);

    if (policy.jitter) {
      // Add random jitter to prevent thundering herd
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    return Math.floor(delay);
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName = 'operation'
  ): Promise<T> {
    const policy = this.policy as RetryPolicy;
    let lastError: ACPError;
    const correlationId = this.logger.generateCorrelationId();

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      try {
        this.logger.logDebug(`Attempting ${operationName}`, {
          attempt,
          maxAttempts: policy.maxAttempts,
          correlationId
        });

        const result = await operation();
        
        if (attempt > 1) {
          this.logger.logInfo(`${operationName} succeeded after ${attempt} attempts`, {
            correlationId
          });
        }

        return result;
      } catch (error) {
        const acpError = ErrorHandler.handle(error);
        lastError = acpError;

        this.logger.logWarning(`${operationName} failed on attempt ${attempt}`, acpError, {
          attempt,
          maxAttempts: policy.maxAttempts,
          correlationId
        });

        // Check if we should retry this error
        const shouldRetry = policy.retryCondition ? 
          policy.retryCondition(acpError) : 
          RetryHandler.isRetryableError(acpError);

        if (!shouldRetry || attempt === policy.maxAttempts) {
          this.logger.logError(`${operationName} failed permanently`, acpError, {
            totalAttempts: attempt,
            correlationId
          });
          throw acpError;
        }

        const delay = this.calculateDelay(attempt);
        
        this.logger.logDebug(`Retrying ${operationName} in ${delay}ms`, {
          attempt,
          delay,
          correlationId
        });

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static createPolicy(overrides: Partial<RetryPolicy>): RetryPolicy {
    return { ...RetryHandler.DEFAULT_POLICY, ...overrides };
  }
}

interface TimeoutPromiseWithId<T> extends Promise<T> {
  timeoutId?: NodeJS.Timeout;
}

export class TimeoutHandler {
  private logger = ErrorLogger.getInstance();

  async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName = 'operation'
  ): Promise<T> {
    const correlationId = this.logger.generateCorrelationId();
    
    this.logger.logDebug(`Starting ${operationName} with ${timeoutMs}ms timeout`, {
      timeout: timeoutMs,
      correlationId
    });

    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        this.logger.logWarning(`${operationName} timed out after ${timeoutMs}ms`, undefined, {
          timeout: timeoutMs,
          correlationId
        });
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }) as TimeoutPromiseWithId<never>;

    // Store timeout ID for cleanup
    timeoutPromise.timeoutId = timeoutId;

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      
      // Clear the timeout if the main promise resolves first
      if (timeoutPromise.timeoutId) {
        clearTimeout(timeoutPromise.timeoutId);
      }

      this.logger.logDebug(`${operationName} completed successfully`, {
        correlationId
      });

      return result;
    } catch (error) {
      // Clear timeout on error too
      if (timeoutPromise.timeoutId) {
        clearTimeout(timeoutPromise.timeoutId);
      }

      const acpError = ErrorHandler.handle(error);
      this.logger.logError(`${operationName} failed`, acpError, {
        correlationId
      });
      
      throw acpError;
    }
  }

  createTimeoutPromise<T>(timeoutMs: number): Promise<T> {
    return new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }
}

export class ErrorHandler {
  static handle(error: unknown): ACPError {
    if (error instanceof z.ZodError) {
      return {
        code: -32602, // Invalid params
        message: 'Invalid message format',
        data: { details: error.format() }
      };
    }
    
    if (error instanceof ClaudeSDKError) {
      if (error.status === 429) {
        return {
          code: 429,
          message: 'Rate limit exceeded. Please try again later.',
          data: { retryAfter: error.retryAfter }
        };
      }
      
      if (error.status === 401) {
        return {
          code: -32000, // Custom auth error
          message: 'Authentication required',
          data: { authUrl: error.authUrl }
        };
      }

      if (error.status === 400) {
        return {
          code: -32600, // Invalid request
          message: `Bad request: ${error.message}`,
          data: { details: error.message }
        };
      }

      if (error.status >= 500) {
        return {
          code: -32603, // Internal error
          message: 'Server error occurred',
          data: { details: error.message }
        };
      }
    }

    if (error instanceof Error) {
      // Handle AbortError specifically
      if (error.name === 'AbortError') {
        return {
          code: -32000, // Custom cancelled error
          message: 'Operation was cancelled',
          data: {}
        };
      }

      // Handle other known Node.js errors
      if ('code' in error) {
        const nodeError = error as NodeJS.ErrnoException;
        switch (nodeError.code) {
          case 'ENOENT':
            return {
              code: -32001,
              message: `File not found: ${nodeError.path}`,
              data: { path: nodeError.path }
            };
          case 'EACCES':
            return {
              code: -32002,
              message: `Permission denied: ${nodeError.path}`,
              data: { path: nodeError.path }
            };
          case 'EMFILE':
          case 'ENFILE':
            return {
              code: -32003,
              message: 'Too many open files',
              data: { details: nodeError.message }
            };
        }
      }
    }
    
    // Generic error with helpful context
    return {
      code: -32603, // Internal error
      message: error instanceof Error ? error.message : 'Unknown error',
      data: { 
        stack: process.env.DEBUG ? (error instanceof Error ? error.stack : undefined) : undefined
      }
    };
  }

  static createACPError(code: number, message: string, data?: ErrorData): ACPError {
    return { code, message, data };
  }

  static isRetryableError(error: ACPError): boolean {
    // Rate limits and temporary server errors are retryable
    return error.code === 429 || (error.code >= -32099 && error.code <= -32000);
  }
}

export class ErrorRecovery {
  private strategies: RecoveryStrategy[] = [];
  private logger = ErrorLogger.getInstance();

  constructor() {
    // Register built-in recovery strategies
    this.registerStrategy(new RateLimitRecoveryStrategy());
    this.registerStrategy(new AuthErrorRecoveryStrategy());
    this.registerStrategy(new NetworkErrorRecoveryStrategy());
    this.registerStrategy(new FileSystemErrorRecoveryStrategy());
  }

  registerStrategy(strategy: RecoveryStrategy): void {
    this.strategies.push(strategy);
    this.logger.logDebug(`Registered recovery strategy: ${strategy.name}`);
  }

  async recover(error: ACPError, context?: RecoveryContext): Promise<RecoveryResult> {
    const correlationId = this.logger.generateCorrelationId();
    
    this.logger.logInfo(`Attempting error recovery`, {
      correlationId,
      strategiesCount: this.strategies.length,
      errorCode: error.code,
      errorMessage: error.message
    });

    for (const strategy of this.strategies) {
      if (strategy.canHandle(error)) {
        this.logger.logDebug(`Using recovery strategy: ${strategy.name}`, {
          correlationId
        });

        try {
          const result = await strategy.execute(error, context);
          
          if (result.success) {
            this.logger.logInfo(`Error recovery successful with strategy: ${strategy.name}`, {
              correlationId
            });
          } else {
            this.logger.logWarning(`Error recovery failed with strategy: ${strategy.name}`, result.error, {
              correlationId
            });
          }

          return result;
        } catch (strategyError) {
          const acpError = ErrorHandler.handle(strategyError);
          this.logger.logError(`Recovery strategy ${strategy.name} threw error`, acpError, {
            correlationId
          });
          
          return {
            success: false,
            error: acpError
          };
        }
      }
    }

    this.logger.logWarning(`No recovery strategy found for error`, error, {
      correlationId
    });

    return {
      success: false,
      error: ErrorHandler.createACPError(
        -32004,
        'No recovery strategy available',
        { details: error }
      )
    };
  }
}

// Built-in Recovery Strategies
class RateLimitRecoveryStrategy implements RecoveryStrategy {
  name = 'RateLimitRecovery';

  canHandle(error: ACPError): boolean {
    return error.code === 429;
  }

  async execute(error: ACPError, context?: RecoveryContext): Promise<RecoveryResult> {
    const retryAfter = error.data?.retryAfter || 60; // Default 60 seconds
    
    return {
      success: true,
      retryAfter: retryAfter * 1000, // Convert to milliseconds
      data: {
        message: `Rate limit hit. Retry after ${retryAfter} seconds.`,
        suggestedAction: 'wait'
      }
    };
  }
}

class AuthErrorRecoveryStrategy implements RecoveryStrategy {
  name = 'AuthErrorRecovery';

  canHandle(error: ACPError): boolean {
    return error.code === -32000 && error.message.includes('Authentication');
  }

  async execute(error: ACPError, context?: RecoveryContext): Promise<RecoveryResult> {
    const authUrl = error.data?.authUrl;
    
    if (authUrl) {
      return {
        success: true,
        data: {
          message: 'Authentication required. Please authenticate.',
          authUrl,
          suggestedAction: 'authenticate'
        }
      };
    }

    return {
      success: false,
      error: ErrorHandler.createACPError(
        -32000,
        'Authentication required but no auth URL provided'
      )
    };
  }
}

class NetworkErrorRecoveryStrategy implements RecoveryStrategy {
  name = 'NetworkErrorRecovery';

  canHandle(error: ACPError): boolean {
    // Handle temporary network errors
    return error.code === -32603 && (
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ETIMEOUT') ||
      error.message.includes('ENOTFOUND')
    );
  }

  async execute(error: ACPError, context?: RecoveryContext): Promise<RecoveryResult> {
    const attempt = context?.attempt || 1;
    const maxAttempts = 3;

    if (attempt >= maxAttempts) {
      return {
        success: false,
        error: ErrorHandler.createACPError(
          -32603,
          `Network error persisted after ${maxAttempts} attempts`,
          { originalError: error }
        )
      };
    }

    // Exponential backoff
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);

    return {
      success: true,
      retryAfter: delay,
      data: {
        message: `Network error. Retrying in ${delay}ms (attempt ${attempt}/${maxAttempts}).`,
        suggestedAction: 'retry'
      }
    };
  }
}

class FileSystemErrorRecoveryStrategy implements RecoveryStrategy {
  name = 'FileSystemErrorRecovery';

  canHandle(error: ACPError): boolean {
    return [
      -32001, // FILE_NOT_FOUND
      -32002, // PERMISSION_DENIED
      -32003  // TOO_MANY_FILES
    ].includes(error.code);
  }

  async execute(error: ACPError, context?: RecoveryContext): Promise<RecoveryResult> {
    switch (error.code) {
      case -32001: // FILE_NOT_FOUND
        return {
          success: true,
          data: {
            message: 'File not found. Please check the file path.',
            suggestedAction: 'check_path',
            path: error.data?.path
          }
        };

      case -32002: // PERMISSION_DENIED
        return {
          success: true,
          data: {
            message: 'Permission denied. Please check file permissions.',
            suggestedAction: 'check_permissions',
            path: error.data?.path
          }
        };

      case -32003: // TOO_MANY_FILES
        return {
          success: true,
          retryAfter: 1000, // Retry after 1 second
          data: {
            message: 'Too many open files. Retrying after cleanup.',
            suggestedAction: 'cleanup_and_retry'
          }
        };

      default:
        return {
          success: false,
          error: ErrorHandler.createACPError(
            -32004,
            'Unknown filesystem error',
            { originalError: error }
          )
        };
    }
  }
}

// JSON-RPC error code constants
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
} as const;

// Custom ACP error codes
export const ACP_ERRORS = {
  AUTH_REQUIRED: -32000,
  FILE_NOT_FOUND: -32001,
  PERMISSION_DENIED: -32002,
  TOO_MANY_FILES: -32003,
  CANCELLED: -32004,
  RATE_LIMITED: 429
} as const;

// Backward compatibility export for connection.ts
export const ErrorCodes = JSON_RPC_ERRORS;

export function formatErrorForLogging(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack}`;
  }
  return String(error);
}

export function isACPError(obj: unknown): obj is ACPError {
  return obj !== null && 
         typeof obj === 'object' && 
         typeof (obj as ACPError).code === 'number' && 
         typeof (obj as ACPError).message === 'string';
}