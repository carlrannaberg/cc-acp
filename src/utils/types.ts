import { ReadableStream, WritableStream } from 'node:stream/web';
import { z } from 'zod';

// Import protocol types to avoid duplication
import {
  ContentBlock,
  PermissionOption,
  SessionUpdate,
  ToolCallUpdate
} from '../protocol/schemas.js';

// Import error types to avoid duplication  
import { LogLevel, ACPError } from './errors.js';

/**
 * Core configuration interface for the Claude Code ACP agent
 */
export interface Config {
  /** Current working directory */
  cwd: string;
  /** Enable intelligent search capabilities */
  enableSmartSearch: boolean;
  /** Respect .gitignore files when searching */
  respectGitignore: boolean;
  /** Enable debug logging */
  debug: boolean;
  /** Maximum number of concurrent sessions */
  maxConcurrentSessions?: number;
  /** Session timeout in milliseconds */
  sessionTimeoutMs?: number;
}

/**
 * File system service interface for all file operations
 */
export interface FileSystemService {
  /** Read file contents as string */
  readFile(path: string): Promise<string>;
  /** Write content to file */
  writeFile(path: string, content: string): Promise<void>;
  /** Get file/directory statistics */
  stat(path: string): Promise<Stats>;
  /** Check if path exists */
  exists(path: string): Promise<boolean>;
  /** Read directory contents */
  readdir(path: string): Promise<string[]>;
  /** Create directory */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}

/**
 * File system statistics interface
 */
export interface Stats {
  /** Check if path is a file */
  isFile(): boolean;
  /** Check if path is a directory */
  isDirectory(): boolean;
  /** File size in bytes */
  size: number;
  /** Last modified time */
  mtime: Date;
  /** File permissions mode */
  mode: number;
}

/**
 * Message interface for conversation history
 */
export interface Message {
  /** Message role */
  role: 'user' | 'assistant' | 'system';
  /** Message content */
  content: string | ContentBlock[];
  /** Message timestamp */
  timestamp: Date;
}

// Re-export ContentBlock from protocol schemas to avoid duplication
export type { ContentBlock } from '../protocol/schemas.js';

/**
 * Permission decision for tool calls
 */
export interface PermissionDecision {
  /** Whether permission is granted */
  allowed: boolean;
  /** Permission scope */
  scope: 'once' | 'always' | 'never';
  /** Tool name for permission */
  tool?: string;
  /** Command for permission */
  command?: string;
  /** Cache key for permission */
  cacheKey?: string;
}

// Re-export PermissionOption from protocol schemas to avoid duplication
export type { PermissionOption } from '../protocol/schemas.js';

/**
 * Tool call interface for Claude interactions - extends protocol ToolCallUpdate
 */
export interface ToolCall extends Omit<ToolCallUpdate, 'toolCallId'> {
  /** Unique tool call identifier */
  id: string;
  /** Tool name */
  name: string;
  /** Tool call type */
  type: 'file_edit' | 'execute' | 'read' | 'search' | 'other';
  /** Human-readable description */
  description: string;
  /** Command to execute (if applicable) */
  command?: string;
  /** Tool arguments */
  args?: Record<string, unknown>;
  /** Execute the tool call */
  execute(): Promise<ToolResult>;
}

/**
 * Result of tool execution
 */
export interface ToolResult {
  /** Whether execution was successful */
  success: boolean;
  /** Output from execution */
  output?: string;
  /** Error message if failed */
  error?: string;
  /** Files affected by the operation */
  files?: string[];
  /** File diff information */
  diff?: {
    path: string;
    oldText: string;
    newText: string;
  };
}

/**
 * Resolved content from file operations
 */
export interface ResolvedContent {
  /** Content type */
  type: 'file' | 'content' | 'error';
  /** File path */
  path?: string;
  /** File content */
  content?: string;
  /** Content block */
  block?: ContentBlock;
  /** Error message */
  message?: string;
}

/**
 * ACP Client interface for protocol communication
 */
export interface ACPClient {
  /** Send session update to ACP server */
  sessionUpdate(params: {
    sessionId: string;
    update: SessionUpdate;
  }): Promise<void>;
  
  /** Request permission from ACP server */
  requestPermission(params: {
    sessionId: string;
    toolCall: ToolCallUpdate;
    options: PermissionOption[];
  }): Promise<{ outcome: { outcome: string; optionId?: string } }>;
  
  /** Read text file through ACP */
  readTextFile(params: {
    sessionId: string;
    path: string;
    line?: number;
    limit?: number;
  }): Promise<{ content: string }>;
  
  /** Write text file through ACP */
  writeTextFile(params: {
    sessionId: string;
    path: string;
    content: string;
  }): Promise<void>;
}

/**
 * Claude SDK interface for AI interactions
 */
export interface ClaudeSDK {
  /** Query Claude with options */
  query(options: {
    prompt: string;
    options: {
      abortController?: AbortController;
      conversationId?: string;
      onToolCall?: (tool: ToolCall) => Promise<void>;
      permissionMode?: 'default' | 'custom' | 'none';
      permissionHandler?: (tool: ToolCall) => Promise<PermissionDecision>;
      maxTurns?: number;
      allowedTools?: string[];
    };
  }): AsyncIterableIterator<ClaudeMessage>;
}

/**
 * Claude message from SDK
 */
export interface ClaudeMessage {
  /** Message type */
  type: 'assistant' | 'user' | 'system' | 'tool_use' | 'tool_result' | 'error';
  /** Message content */
  content?: string;
  /** Tool name */
  name?: string;
  /** Tool call ID */
  tool_call_id?: string;
  /** Error message */
  error?: string;
}

// Re-export SessionUpdate from protocol schemas to avoid duplication
export type { SessionUpdate } from '../protocol/schemas.js';

/**
 * Connection interface for protocol communication
 */
export interface Connection {
  /** Send request and await response */
  sendRequest<T>(method: string, params?: unknown): Promise<T>;
  /** Send notification (no response expected) */
  sendNotification(method: string, params?: unknown): Promise<void>;
}

/**
 * Method handler type for protocol methods
 */
export type MethodHandler = (method: string, params?: unknown) => Promise<unknown>;

/**
 * Disposable resource interface
 */
export interface Disposable {
  /** Dispose of the resource */
  dispose(): void | Promise<void>;
}

/**
 * Cancellable operation interface
 */
export interface Cancellable {
  /** Cancel the operation */
  cancel(): void | Promise<void>;
}

// Re-export LogLevel from errors to avoid duplication
export { LogLevel } from './errors.js';

/**
 * Logger interface for structured logging
 */
export interface Logger {
  /** Log debug message */
  debug(message: string, ...args: unknown[]): void;
  /** Log info message */
  info(message: string, ...args: unknown[]): void;
  /** Log warning message */
  warn(message: string, ...args: unknown[]): void;
  /** Log error message */
  error(message: string, ...args: unknown[]): void;
}

/**
 * Stream pair for bidirectional communication
 */
export interface StreamPair {
  /** Input stream for writing */
  input: WritableStream<Uint8Array>;
  /** Output stream for reading */
  output: ReadableStream<Uint8Array>;
}

/**
 * Generic result type for operations that can succeed or fail
 * Uses ACPError as default error type for better integration
 */
export type Result<T, E = ACPError> = 
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Create a successful result
 */
export function createResult<T>(data: T): Result<T> {
  return { success: true, data };
}

/**
 * Create an error result
 */
export function createError<E = ACPError>(error: E): Result<never, E> {
  return { success: false, error };
}

/**
 * Create an ACP error result
 */
export function createACPError(code: number, message: string, data?: ACPError['data']): Result<never, ACPError> {
  return { success: false, error: { code, message, data } };
}

/**
 * Type guard to check if result is successful
 */
export function isSuccess<T, E>(result: Result<T, E>): result is { success: true; data: T } {
  return result.success;
}

/**
 * Type guard to check if result is an error
 */
export function isError<T, E>(result: Result<T, E>): result is { success: false; error: E } {
  return !result.success;
}

// Zod Schema Integration for Type Validation
// Bridge functions to integrate with protocol validation

/**
 * Validate and convert unknown data to typed result
 */
export function validateWithSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): Result<T, ACPError> {
  try {
    const validated = schema.parse(data);
    return createResult(validated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createACPError(
        -32602, // Invalid params
        'Schema validation failed',
        { details: error.format() }
      );
    }
    return createACPError(
      -32603, // Internal error
      'Validation error',
      { details: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Safe parse with result wrapper
 */
export function safeParseWithResult<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): Result<T, ACPError> {
  const result = schema.safeParse(data);
  if (result.success) {
    return createResult(result.data);
  }
  return createACPError(
    -32602, // Invalid params
    'Schema validation failed',
    { details: result.error.format() }
  );
}

/**
 * Type-safe schema validator factory
 */
export function createValidator<T>(schema: z.ZodSchema<T>) {
  return {
    validate: (data: unknown): Result<T, ACPError> => validateWithSchema(schema, data),
    safeParse: (data: unknown): Result<T, ACPError> => safeParseWithResult(schema, data),
    schema,
    /** Check if data matches schema without parsing */
    check: (data: unknown): data is T => schema.safeParse(data).success,
    /** Assert data matches schema, throws on failure */
    assert: (data: unknown): asserts data is T => {
      const result = schema.safeParse(data);
      if (!result.success) {
        throw new Error(`Schema validation failed: ${result.error.message}`);
      }
    }
  };
}

// Shared path utilities to avoid duplication
export namespace PathUtils {
  /**
   * Normalize file path to absolute path
   */
  export function normalizePath(filePath: string, cwd = process.cwd()): string {
    const path = require('path');
    if (path.isAbsolute(filePath)) {
      return path.normalize(filePath);
    }
    
    // Convert relative path to absolute using provided working directory
    return path.resolve(cwd, filePath);
  }

  /**
   * Verify path is within project boundaries (prevent directory traversal)
   */
  export function isWithinRoot(filePath: string, rootPath: string): boolean {
    const path = require('path');
    const normalized = path.normalize(filePath);
    const normalizedRoot = path.normalize(rootPath);
    
    return normalized.startsWith(normalizedRoot + path.sep) || normalized === normalizedRoot;
  }
}