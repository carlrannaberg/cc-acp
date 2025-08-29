// JSON-RPC handling for ACP protocol communication (~400 lines expected)

import { ErrorCodes } from '../utils/errors.js';

// JSON-RPC 2.0 Custom Error Codes (extending base ErrorCodes)
export const JSON_RPC_ERROR_CODES = {
  ...ErrorCodes,
  // Custom error codes for JSON-RPC
  TIMEOUT_ERROR: -32001,
  CONNECTION_ERROR: -32002,
  AUTHORIZATION_ERROR: -32003,
} as const;

// TypeScript interfaces for JSON-RPC 2.0 messages
export interface JsonRpcMessage {
  jsonrpc: '2.0';
}

export interface JsonRpcRequest extends JsonRpcMessage {
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification extends JsonRpcMessage {
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse extends JsonRpcMessage {
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type AnyMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export interface PendingResponse {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
}

export type MethodHandler = (method: string, params?: unknown) => Promise<unknown>;

export interface ConnectionOptions {
  requestTimeout?: number; // Timeout for pending requests in milliseconds
  debug?: boolean;
}

export class Connection {
  private pendingResponses = new Map<string | number, PendingResponse>();
  private nextRequestId = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private closed = false;
  private options: Required<ConnectionOptions>;

  constructor(
    private handler: MethodHandler,
    private input: WritableStream<Uint8Array>,
    private output: ReadableStream<Uint8Array>,
    options: ConnectionOptions = {}
  ) {
    this.options = {
      requestTimeout: options.requestTimeout ?? 30000, // 30 seconds default
      debug: options.debug ?? false,
    };
    
    this.receive().catch((error) => {
      console.error('Connection receive error:', error);
    });
  }

  private debugLog(...args: unknown[]): void {
    if (this.options.debug) {
      console.error(...args);
    }
  }

  private async receive(): Promise<void> {
    let buffer = '';
    const decoder = new TextDecoder();
    const reader = this.output.getReader();
    
    try {
      while (!this.closed) {
        const { value, done } = await reader.read();
        
        if (done) {
          break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const message = JSON.parse(line);
              await this.processMessage(message);
            } catch (error) {
              this.debugLog('Failed to parse message:', error, 'Line:', line);
              // Send parse error response if we can extract an ID
              try {
                const partialMessage = JSON.parse(line);
                if (partialMessage.id !== undefined) {
                  await this.sendErrorResponse(
                    partialMessage.id,
                    JSON_RPC_ERROR_CODES.PARSE_ERROR,
                    'Parse error',
                    { originalLine: line }
                  );
                }
              } catch {
                // Cannot even partially parse - ignore
              }
            }
          }
        }
      }
    } catch (error) {
      this.debugLog('Connection receive error:', error);
    } finally {
      // Always release the reader lock to prevent resource leaks
      reader.releaseLock();
    }
  }

  private async processMessage(message: AnyMessage): Promise<void> {
    this.debugLog('Processing message:', message);

    // Validate JSON-RPC 2.0 format
    if (message.jsonrpc !== '2.0') {
      if ('id' in message && message.id !== undefined) {
        await this.sendErrorResponse(
          message.id,
          JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          'Invalid JSON-RPC version'
        );
      }
      return;
    }

    if ('method' in message && 'id' in message) {
      // Request - call handler and send response
      await this.handleRequest(message as JsonRpcRequest);
    } else if ('method' in message) {
      // Notification - call handler without response
      await this.handleNotification(message as JsonRpcNotification);
    } else if ('id' in message) {
      // Response - resolve pending request
      this.handleResponse(message as JsonRpcResponse);
    } else {
      // Invalid message format
      const messageWithId = message as { id?: string | number };
      if (messageWithId.id !== undefined) {
        await this.sendErrorResponse(
          messageWithId.id,
          JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          'Invalid message format'
        );
      }
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    try {
      const result = await this.tryCallHandler(request.method, request.params);
      
      if ('result' in result) {
        await this.sendMessage({
          jsonrpc: '2.0',
          id: request.id,
          result: result.result,
        });
      } else if ('error' in result) {
        await this.sendMessage({
          jsonrpc: '2.0',
          id: request.id,
          error: result.error,
        });
      }
    } catch (error) {
      await this.sendErrorResponse(
        request.id,
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        'Internal error',
        { message: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  private async handleNotification(notification: JsonRpcNotification): Promise<void> {
    try {
      await this.tryCallHandler(notification.method, notification.params);
    } catch (error) {
      // Notifications don't return errors, but we can log them
      this.debugLog('Notification handler error:', error);
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingResponses.get(response.id);
    if (pending) {
      // Clear timeout
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      
      this.pendingResponses.delete(response.id);
      
      if ('error' in response && response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private async tryCallHandler(
    method: string, 
    params?: unknown
  ): Promise<{ result?: unknown } | { error: JsonRpcError }> {
    try {
      const result = await this.handler(method, params);
      return { result: result ?? null };
    } catch (error) {
      return { error: this.formatError(error) };
    }
  }

  private formatError(error: unknown): JsonRpcError {
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      const errorObj = error as { code: number; message: string; data?: unknown };
      return {
        code: errorObj.code,
        message: errorObj.message,
        data: errorObj.data,
      };
    }

    if (error instanceof Error) {
      return {
        code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        message: error.message,
        data: { stack: error.stack },
      };
    }

    return {
      code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      message: 'Unknown error',
      data: { error: String(error) },
    };
  }

  private async sendErrorResponse(
    id: string | number,
    code: number,
    message: string,
    data?: unknown
  ): Promise<void> {
    await this.sendMessage({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data,
      },
    });
  }

  // Queued writes to prevent message interleaving
  private async sendMessage(message: unknown): Promise<void> {
    if (this.closed) {
      throw new Error('Connection is closed');
    }

    this.writeQueue = this.writeQueue.then(async () => {
      const writer = this.input.getWriter();
      try {
        const data = JSON.stringify(message) + '\n';
        await writer.write(new TextEncoder().encode(data));
        
        this.debugLog('Sent message:', message);
      } finally {
        writer.releaseLock();
      }
    }).catch(error => {
      console.error('Write error:', error);
      throw error;
    });
    
    return this.writeQueue;
  }

  async sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      throw new Error('Connection is closed');
    }

    // Input validation
    if (typeof method !== 'string' || method.trim().length === 0) {
      throw new Error('Method must be a non-empty string');
    }

    const id = this.nextRequestId++;
    
    const promise = new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingResponses.delete(id);
        reject(new Error(`Request timeout after ${this.options.requestTimeout}ms`));
      }, this.options.requestTimeout);

      this.pendingResponses.set(id, { 
        resolve: resolve as (value: unknown) => void, 
        reject,
        timeoutId
      });
    });
    
    await this.sendMessage({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });
    
    return promise;
  }

  async sendNotification(method: string, params?: unknown): Promise<void> {
    if (this.closed) {
      throw new Error('Connection is closed');
    }

    // Input validation
    if (typeof method !== 'string' || method.trim().length === 0) {
      throw new Error('Method must be a non-empty string');
    }

    await this.sendMessage({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    // Cancel all pending requests
    for (const [id, pending] of this.pendingResponses) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending.reject(new Error('Connection closed'));
    }
    this.pendingResponses.clear();

    // Wait for any pending writes to complete
    try {
      await this.writeQueue;
    } catch (error) {
      // Ignore write errors during close
    }

    // Close streams
    try {
      const writer = this.input.getWriter();
      await writer.close();
    } catch (error) {
      // Ignore errors during close
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get pendingRequestCount(): number {
    return this.pendingResponses.size;
  }
}