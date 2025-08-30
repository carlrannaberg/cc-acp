import { randomUUID } from 'crypto';
import { Readable, Writable } from 'stream';
import { Connection } from '../protocol/connection.js';
import * as path from 'path';
import * as os from 'os';
import ACPFileSystem from '../files/filesystem.js';
import { SessionManager, Session } from './session.js';
import { PermissionManager } from './permissions.js';

/**
 * Global error handler management for process-level error handling
 * Ensures process error handlers are registered only once per process
 */
class GlobalErrorHandler {
  private static initialized = false;
  
  static initialize(): void {
    if (GlobalErrorHandler.initialized) return;
    
    process.on('uncaughtException', (error) => {
      console.error('Uncaught exception:', error);
      process.exit(1);
    });
    
    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled rejection:', reason);
      process.exit(1);
    });
    
    GlobalErrorHandler.initialized = true;
  }
  
  static isInitialized(): boolean {
    return GlobalErrorHandler.initialized;
  }
}
import { 
  InitializeRequest, 
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  PromptRequest,
  PromptResponse,
  AuthenticateRequest,
  AuthenticateResponse,
  CancelNotification,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  ToolCallUpdate,
  PermissionOption,
  ContentBlock,
  ClientCapabilities,
  initializeRequestSchema,
  newSessionRequestSchema,
  loadSessionRequestSchema,
  promptRequestSchema,
  authenticateRequestSchema,
  cancelNotificationSchema,
  requestPermissionRequestSchema,
  readTextFileRequestSchema,
  writeTextFileRequestSchema
} from '../protocol/schemas.js';
import { 
  Config, 
  ACPClient, 
  ClaudeSDK, 
  FileSystemService,
  SessionUpdate,
  ToolCall,
  ClaudeMessage,
  PermissionDecision,
  validateWithSchema,
  isSuccess
} from '../utils/types.js';
import { ErrorHandler, JSON_RPC_ERRORS, ACPError } from '../utils/errors.js';
import { z } from 'zod';

// Import the real Claude SDK from @anthropic-ai/claude-code
import { query as claudeQuery, type SDKMessage, type Options } from '@anthropic-ai/claude-code';
import { LRUCache } from 'lru-cache';
import { globalPerformanceMonitor, globalMemoryManager } from '../utils/performance.js';

/**
 * Main ACP Agent implementation with performance optimizations
 * Handles protocol lifecycle and manages multiple sessions
 */
export class ClaudeACPAgent implements ACPClient {
  private connection: Connection;
  private sessionManager: SessionManager;
  private initialized = false;
  private authMethods: Array<{ id: string; name: string; description?: string }> = [];
  private diskFileSystem: FileSystemService;
  public permissionManager: PermissionManager; // Make public for Session access
  private clientCapabilities?: ClientCapabilities; // Store client capabilities from initialize
  
  // Connection pooling for Claude SDK
  private claudeSDKPool = new Map<string, { sdk: ClaudeSDK; lastUsed: number; inUse: boolean }>();
  private readonly MAX_POOL_SIZE = 5;
  private readonly POOL_CLEANUP_INTERVAL = 300000; // 5 minutes
  private poolCleanupTimer!: NodeJS.Timeout;
  
  // Performance monitoring
  private performanceMetrics = {
    requestCount: 0,
    totalResponseTime: 0,
    errorCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    startTime: Date.now()
  };

  // Type guard for result messages
  private isResultMessage(message: ClaudeMessage): message is ClaudeMessage & { subtype: string; result?: string } {
    return 'subtype' in message && typeof (message as unknown as Record<string, unknown>).subtype === 'string';
  }

  // Type guard for messages with result and subtype properties
  private hasResultAndSubtype(message: unknown): message is { subtype: string; result?: string } {
    return typeof message === 'object' && 
           message !== null && 
           'subtype' in message && 
           typeof (message as Record<string, unknown>).subtype === 'string';
  }
  
  // Configuration from environment
  private readonly config: AgentConfig = {
    maxSessions: parseInt(process.env.MAX_SESSIONS || '10'),
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || '3600000'), // 1 hour
    debug: process.env.DEBUG === 'true',
    claudeApiKey: process.env.CLAUDE_API_KEY,
    enableSmartSearch: process.env.ENABLE_SMART_SEARCH !== 'false',
    respectGitignore: process.env.RESPECT_GITIGNORE !== 'false',
    maxTurns: process.env.CLAUDE_MAX_TURNS ? parseInt(process.env.CLAUDE_MAX_TURNS) : undefined,
    model: process.env.CLAUDE_MODEL,
    fallbackModel: process.env.CLAUDE_FALLBACK_MODEL,
    customSystemPrompt: process.env.CLAUDE_CUSTOM_SYSTEM_PROMPT,
    appendSystemPrompt: process.env.CLAUDE_APPEND_SYSTEM_PROMPT,
    additionalDirectories: process.env.CLAUDE_ADDITIONAL_DIRS ? process.env.CLAUDE_ADDITIONAL_DIRS.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    permissionMode: process.env.CLAUDE_PERMISSION_MODE as AgentConfig['permissionMode'],
    allowedTools: process.env.CLAUDE_ALLOWED_TOOLS ? process.env.CLAUDE_ALLOWED_TOOLS.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    disallowedTools: process.env.CLAUDE_DISALLOWED_TOOLS ? process.env.CLAUDE_DISALLOWED_TOOLS.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    strictMcpConfig: process.env.CLAUDE_STRICT_MCP_CONFIG === 'true',
    maxThinkingTokens: process.env.CLAUDE_MAX_THINKING_TOKENS ? parseInt(process.env.CLAUDE_MAX_THINKING_TOKENS) : undefined
  };

  constructor(
    input: Readable = process.stdin,
    output: Writable = process.stdout,
    diskFileSystem?: FileSystemService
  ) {
    // Ensure critical environment defaults are present (best-effort)
    if (!process.env.HOME && process.platform !== 'win32') {
      process.env.HOME = os.homedir?.() || process.env.HOME || '';
    }
    if (!process.env.XDG_CONFIG_HOME && process.env.HOME) {
      process.env.XDG_CONFIG_HOME = path.join(process.env.HOME, '.config');
    }
    if (process.env.ACP_LOG_LEVEL === 'debug' && process.env.DEBUG !== 'true') {
      process.env.DEBUG = 'true';
    }
    // Create default disk filesystem if not provided
    this.diskFileSystem = diskFileSystem || new ACPFileSystem(this, '', undefined, process.cwd());
    
    // Initialize permission manager
    this.permissionManager = new PermissionManager(this, '');
    
    // Initialize session manager
    this.sessionManager = new SessionManager({
      maxSessions: this.config.maxSessions,
      sessionTimeoutMs: this.config.sessionTimeoutMs
    });

    // Create connection with protocol handler
    this.connection = new Connection(
      this.handleMethod.bind(this),
      this.createWritableStream(output),
      this.createReadableStream(input),
      { 
        debug: this.config.debug,
        requestTimeout: 30000 
      }
    );

    this.setupErrorHandlers();
    this.setupPerformanceMonitoring();
  }

  /**
   * Handle incoming ACP protocol methods
   */
  private async handleMethod(method: string, params?: unknown): Promise<unknown> {
    try {
      switch (method) {
        case 'initialize':
          return await this.initialize(this.validateParams(initializeRequestSchema, params));
          
        case 'session/new':
          return await this.newSession(this.validateParams(newSessionRequestSchema, params));
          
        case 'session/load':
          return await this.loadSession(this.validateParams(loadSessionRequestSchema, params));
          
        case 'session/prompt':
          return await this.prompt(this.validateParams(promptRequestSchema, params));
          
        case 'authenticate':
          return await this.authenticate(this.validateParams(authenticateRequestSchema, params));
          
        case 'session/cancel':
          await this.cancel(this.validateParams(cancelNotificationSchema, params));
          return null;
          
        case 'session/request_permission':
          return await this.requestPermission(this.validateParams(requestPermissionRequestSchema, params));
          
        case 'fs/read_text_file':
          return await this.readTextFile(this.validateParams(readTextFileRequestSchema, params));
          
        case 'fs/write_text_file':
          await this.writeTextFile(this.validateParams(writeTextFileRequestSchema, params));
          return null;
          
        default:
          throw this.createMethodNotFoundError(`Method '${method}' not found`);
      }
    } catch (error) {
      if (this.config.debug) {
        console.error(`Error handling method ${method}:`, error);
      }
      throw ErrorHandler.handle(error);
    }
  }

  /**
   * Initialize the ACP agent
   */
  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    if (this.initialized) {
      throw this.createInvalidRequestError('Agent already initialized');
    }

    // Validate protocol version
    if (params.protocolVersion !== 1) {
      throw this.createInvalidRequestError(
        `Unsupported protocol version: ${params.protocolVersion}. Expected: 1`
      );
    }

    // Store client capabilities for later use
    this.clientCapabilities = params.clientCapabilities;
    
    // Set up authentication methods with validation
    await this.setupAuthMethods();
    
    this.initialized = true;

    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: true,
          audio: false,
          embeddedContext: true
        }
      },
      authMethods: this.authMethods.length > 0 ? this.authMethods : undefined
    };
  }

  /**
   * Create new session
   */
  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    this.ensureInitialized();
    
    const sessionId = randomUUID();
    // Fail fast if MCP servers are provided - not yet implemented
    if (params.mcpServers && params.mcpServers.length > 0) {
      throw this.createInvalidRequestError(
        `MCP servers not implemented in this version. Found ${params.mcpServers.length} server(s). Please remove from configuration.`
      );
    }

    const sessionConfig: Config = {
      cwd: params.cwd,
      enableSmartSearch: this.config.enableSmartSearch,
      respectGitignore: this.config.respectGitignore,
      debug: this.config.debug,
      maxConcurrentSessions: this.config.maxSessions,
      sessionTimeoutMs: this.config.sessionTimeoutMs
    };

    // Create Claude SDK instance
    const claudeSDK = this.createClaudeSDK();

    // Create session through session manager
    const session = await this.sessionManager.createSession(
      sessionId,
      sessionConfig,
      this.diskFileSystem,
      claudeSDK,
      this
    );
    

    if (this.config.debug) {
      console.error(`Created session: ${sessionId} in ${params.cwd}`);
    }

    return { sessionId };
  }

  /**
   * Load existing session (optional method)
   */
  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    this.ensureInitialized();
    
    const session = await this.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw this.createSessionNotFoundError(`Session not found: ${params.sessionId}`);
    }

    // Fail fast if MCP servers are provided - not yet implemented
    if (params.mcpServers && params.mcpServers.length > 0) {
      throw this.createInvalidRequestError(
        `MCP servers not implemented in this version. Found ${params.mcpServers.length} server(s). Please remove from configuration.`
      );
    }

    // Update session configuration
    session.config.cwd = params.cwd;
    session.updateLastUsed();

    if (this.config.debug) {
      console.error(`Loaded session: ${params.sessionId} in ${params.cwd}`);
    }

    return null; // LoadSessionResponse is null according to schema
  }

  /**
   * Handle prompt request with performance monitoring
   */
  async prompt(params: PromptRequest): Promise<PromptResponse> {
    this.ensureInitialized();
    
    const requestStart = Date.now();
    this.performanceMetrics.requestCount++;
    
    const session = await this.getSession(params.sessionId);
    
    // Update last used timestamp
    session.updateLastUsed();

    // Get abort controller for cancellation
    const abortController = session.getAbortController();

    try {
      // Convert prompt content to string for Claude SDK
      const promptText = this.contentBlocksToString(params.prompt);

      // Get pooled Claude SDK for better performance
      const pooledSDK = this.getPooledClaudeSDK(session.id, session.config.cwd);
      
      // Query Claude SDK
      // Send a brief diagnostic message only in debug mode
      if (this.config.debug) {
        await this.sessionUpdate({
          sessionId: session.id,
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: {
              type: 'text',
              text: `[Diag] cwd=${session.config.cwd} cliPath=${this.resolveClaudeCliPath() ?? 'auto'} HOME=${process.env.HOME ?? ''} XDG_CONFIG_HOME=${process.env.XDG_CONFIG_HOME ?? ''}`
            }
          }
        });
      }

      const response = await pooledSDK.query({
        prompt: promptText,
        options: {
          abortController: abortController,
          conversationId: session.id,
          onToolCall: async (tool: ToolCall) => {
            await this.handleToolCall(session, tool);
          },
          permissionHandler: async (tool: ToolCall) => {
            return await this.handlePermissionRequest(session, tool);
          }
        }
      });

      // Stream response chunks
      let emitted = false;
      let stopReason: 'end_turn' | 'max_turn_requests' = 'end_turn';
      for await (const message of response) {
        if (abortController.signal.aborted) {
          this.releasePooledSDK(session.id);
          return { stopReason: 'cancelled' };
        }
        // Intercept certain result subtypes to avoid duplication and surface useful info
        if (this.isResultMessage(message)) {
          const subtype = message.subtype;
          if (subtype === 'error_max_turns') {
            stopReason = 'max_turn_requests';
            await this.sendClaudeMessage(session.id, {
              type: 'assistant',
              content: 'Reached maximum reasoning steps for this turn. If you want me to continue, say "continue" or provide more specific guidance.'
            });
            continue;
          }
          if (subtype.startsWith('error')) {
            await this.sendClaudeMessage(session.id, {
              type: 'error',
              error: message.result || subtype || 'Execution error occurred'
            } as ClaudeMessage);
            emitted = true;
            continue;
          }
          // Ignore normal success result to prevent duplicated assistant output
          continue;
        }
        await this.sendClaudeMessage(session.id, message);
        emitted = true;
      }
      
      // If the model produced no output, send a helpful fallback message
      if (!emitted) {
        await this.sessionUpdate({
          sessionId: session.id,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: 'No output received from model. Ensure Claude Code authentication is configured (subscription login or CLAUDE_API_KEY).' 
            }
          }
        });
      }
      
      // Release SDK back to pool
      this.releasePooledSDK(session.id);
      
      // Record performance metrics
      const responseTime = Date.now() - requestStart;
      this.performanceMetrics.totalResponseTime += responseTime;
      
      if (this.config.debug && responseTime > 100) {
        console.error(`Slow request detected: ${responseTime}ms for session ${params.sessionId}`);
      }

      return { stopReason };
    } catch (error) {
      this.performanceMetrics.errorCount++;
      this.releasePooledSDK(session.id);
      
      if (abortController.signal.aborted) {
        return { stopReason: 'cancelled' };
      }
      
      // Send error to client with brief diagnostics
      const err = error as Error;
      const diag = [
        `Error: ${err?.message || String(error)}`,
        this.config.debug && err?.stack ? `\nStack: ${err.stack.split('\n').slice(0,3).join('\n')}` : ''
      ].filter(Boolean).join('');
      await this.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: diag
          }
        }
      });
      
      throw ErrorHandler.handle(error);
    }
  }

  /**
   * Handle authentication
   */
  async authenticate(params: AuthenticateRequest): Promise<AuthenticateResponse> {
    this.ensureInitialized();
    
    const authMethod = this.authMethods.find(method => method.id === params.methodId);
    if (!authMethod) {
      throw this.createInvalidRequestError(`Unknown auth method: ${params.methodId}`);
    }

    // Handle different authentication methods with real validation
    if (params.methodId === 'api-key') {
      if (!this.config.claudeApiKey) {
        throw this.createAuthError('Claude API key not configured. Set CLAUDE_API_KEY environment variable.');
      }
      
      // Test API key by creating a minimal Claude SDK query
      console.info('[ACP] Validating Claude API key authentication');
      try {
        const testSDK = this.createClaudeSDK();
        const testQuery = testSDK.query({
          prompt: "test",
          options: { maxTurns: 1, allowedTools: [] }
        });
        
        // Try to get first response to validate authentication
        const iterator = testQuery[Symbol.asyncIterator]();
        const firstResult = await iterator.next();
        
        if (firstResult.done || !firstResult.value) {
          throw new Error('No response received - authentication may have failed');
        }
        
        console.info('[ACP] Claude API key authentication validated successfully');
      } catch (error) {
        console.error('[ACP] API key authentication failed:', error);
        throw this.createAuthError(`Claude API key authentication failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    if (params.methodId === 'claude-code-subscription') {
      console.info('[ACP] Validating Claude Code subscription authentication');
      
      // Test Claude Code subscription by attempting a query without API key
      try {
        const testSDK = this.createClaudeSDK();
        const testQuery = testSDK.query({
          prompt: "test",
          options: { maxTurns: 1, allowedTools: [] }
        });
        
        const iterator = testQuery[Symbol.asyncIterator]();
        const firstResult = await iterator.next();
        
        if (firstResult.done || !firstResult.value) {
          throw new Error('No response received');
        }
        
        // Check if authentication was successful by verifying we got a valid response
        if (firstResult.value.type && firstResult.value.type === 'system') {
          console.info('[ACP] Claude Code subscription authentication validated successfully');
        } else {
          throw new Error('Unexpected response format');
        }
      } catch (error) {
        console.error('[ACP] Claude Code subscription authentication failed:', error);
        throw this.createAuthError(
          `Claude Code subscription authentication failed. Please run 'claude auth login' to authenticate: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return null; // AuthenticateResponse is null according to schema
  }

  /**
   * Cancel session operation
   */
  async cancel(params: CancelNotification): Promise<void> {
    const session = await this.sessionManager.getSession(params.sessionId);
    if (session) {
      session.cancel();
      if (this.config.debug) {
        console.error(`Cancelled session: ${params.sessionId}`);
      }
    }
  }

  // ACPClient interface implementation

  async sessionUpdate(params: { sessionId: string; update: SessionUpdate }): Promise<void> {
    await this.connection.sendNotification('session/update', {
      sessionId: params.sessionId,
      update: params.update
    });
  }

  async requestPermission(params: {
    sessionId: string;
    toolCall: ToolCallUpdate;
    options: PermissionOption[];
  }): Promise<{ outcome: { outcome: string; optionId?: string } }> {
    return await this.connection.sendRequest('session/request_permission', params);
  }

  async readTextFile(params: {
    sessionId: string;
    path: string;
    line?: number | null;
    limit?: number | null;
  }): Promise<{ content: string }> {
    // Check client capability and use fallback if needed
    if (this.clientCapabilities?.fs?.readTextFile === false) {
      console.warn(`[ACP] Client filesystem read disabled for session ${params.sessionId}, using disk fallback for: ${params.path}`);
      // Use fallback filesystem directly
      const session = await this.getSession(params.sessionId);
      let content = await this.diskFileSystem.readFile(params.path);
      
      // Apply line/limit filtering if requested
      if (params.line !== undefined && params.line !== null || params.limit !== undefined && params.limit !== null) {
        const lines = content.split('\n');
        const startLine = (params.line ?? 1) - 1; // Convert to 0-based
        const endLine = params.limit ? startLine + params.limit : lines.length;
        content = lines.slice(startLine, endLine).join('\n');
      }
      
      return { content };
    }
    
    // Use ACP protocol
    if (this.config.debug) {
      console.info(`[ACP] Using client filesystem read for session ${params.sessionId}: ${params.path}`);
    }
    const requestParams = {
      sessionId: params.sessionId,
      path: params.path,
      line: params.line ?? undefined,
      limit: params.limit ?? undefined
    };
    return await this.connection.sendRequest('fs/read_text_file', requestParams);
  }

  async writeTextFile(params: {
    sessionId: string;
    path: string;
    content: string;
  }): Promise<void> {
    // Check client capability and use fallback if needed
    if (this.clientCapabilities?.fs?.writeTextFile === false) {
      console.warn(`[ACP] Client filesystem write disabled for session ${params.sessionId}, using disk fallback for: ${params.path}`);
      // Use fallback filesystem directly
      await this.diskFileSystem.writeFile(params.path, params.content);
      return;
    }
    
    // Use ACP protocol
    if (this.config.debug) {
      console.info(`[ACP] Using client filesystem write for session ${params.sessionId}: ${params.path}`);
    }
    await this.connection.sendRequest('fs/write_text_file', params);
  }

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    if (this.config.debug) {
      console.error('Claude ACP Agent starting...');
    }
    // Connection is already set up in constructor
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    // Clear timers
    if (this.poolCleanupTimer) {
      clearInterval(this.poolCleanupTimer);
    }
    
    // Clear SDK pool
    this.claudeSDKPool.clear();
    
    // Cancel all active sessions
    await this.sessionManager.destroyAllSessions();
    this.sessionManager.dispose();
    
    await this.connection.close();
    
    if (this.config.debug) {
      console.error('Claude ACP Agent stopped');
      console.error('Performance metrics:', this.getPerformanceReport());
    }
  }

  // Private helper methods

  private validateParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
    const result = validateWithSchema(schema, params);
    if (!isSuccess(result)) {
      throw this.createInvalidParamsError('Invalid parameters', result.error.data);
    }
    return result.data;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw this.createNotInitializedError('Agent not initialized');
    }
  }

  private async getSession(sessionId: string): Promise<Session> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      throw this.createSessionNotFoundError(`Session not found: ${sessionId}`);
    }
    return session;
  }

  // Error creation methods
  private createMethodNotFoundError(message: string): ACPError {
    return { code: JSON_RPC_ERRORS.METHOD_NOT_FOUND, message };
  }

  private createInvalidRequestError(message: string): ACPError {
    return { code: JSON_RPC_ERRORS.INVALID_REQUEST, message };
  }

  private createInvalidParamsError(message: string, data?: unknown): ACPError {
    return { 
      code: JSON_RPC_ERRORS.INVALID_PARAMS, 
      message, 
      data: data ? { details: data } : undefined 
    };
  }

  private createLimitExceededError(message: string): ACPError {
    return { code: -32004, message }; // Custom limit exceeded code
  }

  private createSessionNotFoundError(message: string): ACPError {
    return { code: -32005, message }; // Custom session not found code
  }

  private createNotInitializedError(message: string): ACPError {
    return { code: -32006, message }; // Custom not initialized code
  }

  private createAuthError(message: string): ACPError {
    return { code: -32000, message }; // Auth error code from ACP_ERRORS
  }

  private async setupAuthMethods(): Promise<void> {
    // Check Claude Code subscription authentication availability
    const hasClaudeCodeAuth = await this.checkClaudeCodeAuthentication();
    if (hasClaudeCodeAuth) {
      this.authMethods.push({
        id: 'claude-code-subscription',
        name: 'Claude Code Subscription',
        description: 'Use existing Claude Code login (recommended)'
      });
    }

    // Check API key authentication availability
    if (this.config.claudeApiKey && await this.validateApiKey(this.config.claudeApiKey)) {
      this.authMethods.push({
        id: 'api-key',
        name: 'Claude API Key',
        description: 'Authenticate with Claude API key'
      });
    }

    // Ensure at least one authentication method is available
    if (this.authMethods.length === 0) {
      console.warn('[ACP] No valid authentication methods available. Adding Claude Code subscription as fallback.');
      this.authMethods.push({
        id: 'claude-code-subscription',
        name: 'Claude Code Subscription',
        description: 'Use existing Claude Code login (authentication required)'
      });
    }
  }

  private async checkClaudeCodeAuthentication(): Promise<boolean> {
    try {
      // Test Claude Code SDK without API key
      const testSDK = this.createClaudeSDK();
      const testQuery = testSDK.query({
        prompt: "test",
        options: { maxTurns: 1, allowedTools: [] }
      });
      
      const iterator = testQuery[Symbol.asyncIterator]();
      const firstResult = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);
      
      return !firstResult.done && firstResult.value && 
             typeof firstResult.value === 'object' && 
             firstResult.value !== null &&
             'type' in firstResult.value && 
             firstResult.value.type === 'system';
    } catch (error) {
      console.debug('[ACP] Claude Code authentication check failed:', error);
      return false;
    }
  }

  private async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      // Store original key and test with provided key
      const originalKey = this.config.claudeApiKey;
      this.config.claudeApiKey = apiKey;
      
      const testSDK = this.createClaudeSDK();
      const testQuery = testSDK.query({
        prompt: "test",
        options: { maxTurns: 1, allowedTools: [] }
      });
      
      const iterator = testQuery[Symbol.asyncIterator]();
      const firstResult = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);
      
      this.config.claudeApiKey = originalKey; // Restore original
      return !firstResult.done && firstResult.value != null;
    } catch (error) {
      console.debug('[ACP] API key validation failed:', error);
      return false;
    }
  }

  // Session cleanup is now handled by SessionManager
  // This method is no longer needed but kept for backward compatibility

  private setupErrorHandlers(): void {
    // Use centralized global error handler management
    GlobalErrorHandler.initialize();
  }
  
  /**
   * Setup performance monitoring and cleanup
   */
  private setupPerformanceMonitoring(): void {
    // SDK pool cleanup
    this.poolCleanupTimer = setInterval(() => {
      this.cleanupSDKPool();
    }, this.POOL_CLEANUP_INTERVAL);
    
    // Performance reporting
    if (this.config.debug) {
      setInterval(() => {
        console.error('Performance metrics:', this.getPerformanceReport());
      }, 60000); // Every minute
    }
  }
  
  /**
   * Clean up unused SDK instances
   */
  private cleanupSDKPool(): void {
    const now = Date.now();
    const expiredThreshold = 600000; // 10 minutes
    
    for (const [key, poolItem] of this.claudeSDKPool) {
      if (!poolItem.inUse && (now - poolItem.lastUsed) > expiredThreshold) {
        this.claudeSDKPool.delete(key);
      }
    }
  }
  
  /**
   * Get or create SDK from pool
   */
  private getPooledClaudeSDK(conversationId?: string, cwdOverride?: string): ClaudeSDK {
    const poolKey = conversationId || 'default';
    const poolItem = this.claudeSDKPool.get(poolKey);
    
    if (poolItem && !poolItem.inUse) {
      poolItem.inUse = true;
      poolItem.lastUsed = Date.now();
      this.performanceMetrics.cacheHits++;
      return poolItem.sdk;
    }
    
    // Create new SDK if pool not full
    if (this.claudeSDKPool.size < this.MAX_POOL_SIZE) {
      const sdk = this.createClaudeSDK(cwdOverride);
      this.claudeSDKPool.set(poolKey, {
        sdk,
        lastUsed: Date.now(),
        inUse: true
      });
      this.performanceMetrics.cacheMisses++;
      return sdk;
    }
    
    // Fallback to creating new SDK
    this.performanceMetrics.cacheMisses++;
    return this.createClaudeSDK(cwdOverride);
  }
  
  /**
   * Release SDK back to pool
   */
  private releasePooledSDK(conversationId?: string): void {
    const poolKey = conversationId || 'default';
    const poolItem = this.claudeSDKPool.get(poolKey);
    if (poolItem) {
      poolItem.inUse = false;
      poolItem.lastUsed = Date.now();
    }
  }
  
  /**
   * Get performance report
   */
  private getPerformanceReport(): Record<string, unknown> {
    const uptime = Date.now() - this.performanceMetrics.startTime;
    const avgResponseTime = this.performanceMetrics.requestCount > 0 
      ? this.performanceMetrics.totalResponseTime / this.performanceMetrics.requestCount 
      : 0;
    
    const cacheHitRate = (this.performanceMetrics.cacheHits + this.performanceMetrics.cacheMisses) > 0
      ? (this.performanceMetrics.cacheHits / (this.performanceMetrics.cacheHits + this.performanceMetrics.cacheMisses)) * 100
      : 0;
    
    return {
      uptime: `${Math.round(uptime / 1000)}s`,
      activeSessions: this.sessionManager.getSessionCount(),
      totalRequests: this.performanceMetrics.requestCount,
      avgResponseTime: `${avgResponseTime.toFixed(1)}ms`,
      errorCount: this.performanceMetrics.errorCount,
      cacheHitRate: `${cacheHitRate.toFixed(1)}%`,
      sdkPoolSize: this.claudeSDKPool.size,
      memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MB`
    };
  }

  private createWritableStream(writable: Writable): WritableStream<Uint8Array> {
    return new WritableStream<Uint8Array>({
      write(chunk) {
        return new Promise((resolve, reject) => {
          writable.write(Buffer.from(chunk), (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      },
      close() {
        return new Promise((resolve) => {
          writable.end(() => resolve());
        });
      }
    });
  }

  private createReadableStream(readable: Readable): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        readable.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        
        readable.on('end', () => {
          controller.close();
        });
        
        readable.on('error', (err) => {
          controller.error(err);
        });
      }
    });
  }

  private createClaudeSDK(cwdOverride?: string): ClaudeSDK {
    // API key is optional - Claude Code SDK can use existing authentication
    if (!this.config.claudeApiKey) {
      console.info('[ACP] No CLAUDE_API_KEY found, using Claude Code subscription authentication');
    }

    const self = this;
    return {
      async *query(options: {
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
      }) {
        try {
          // Use real Claude Code SDK with correct API
          const envVars: Record<string, string> = { ...process.env } as Record<string, string>;
          if (!envVars.HOME && process.platform !== 'win32') {
            envVars.HOME = os.homedir() || '';
          }
          if (!envVars.XDG_CONFIG_HOME && envVars.HOME) {
            envVars.XDG_CONFIG_HOME = path.join(envVars.HOME, '.config');
          }
          // Avoid flooding stderr with SDK debug logs; don't propagate DEBUG to child
          if (envVars.DEBUG) {
            delete envVars.DEBUG;
          }
          const cliPath = self.resolveClaudeCliPath();
          const requestedMaxTurns = options.options.maxTurns;
          const configuredMaxTurns = self.config.maxTurns;
          const finalMaxTurns = (requestedMaxTurns ?? configuredMaxTurns);
          const claudeOptions: ExtendedClaudeOptions = {
            abortController: options.options.abortController,
            cwd: cwdOverride || process.cwd(),
            ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
            env: envVars,
            stderr: (data: string) => {
              const text = String(data);
              if (!self.config.debug) return; // Only forward in debug mode
              const firstLine = text.trim().split('\n')[0] || '';
              // Skip noisy debug-only lines
              const ignore = firstLine.includes('[DEBUG]') || firstLine.length === 0;
              const looksError = /\b(error|ERR_|not found|failed)\b/i.test(firstLine);
              if (!ignore && looksError) {
                const msg = firstLine.slice(0, 500);
                self.sessionUpdate({
                  sessionId: options.options.conversationId || 'unknown',
                  update: {
                    sessionUpdate: 'agent_thought_chunk',
                    content: { type: 'text', text: `[Claude stderr] ${msg}` }
                  }
                }).catch(() => {});
              }
            }
          };
          if (options.options.allowedTools && options.options.allowedTools.length > 0) {
            claudeOptions.allowedTools = options.options.allowedTools;
          }
          // Optional SDK options via env-configured agent settings
          const cfg = self.config;
          if (cfg.model) claudeOptions.model = cfg.model;
          if (cfg.fallbackModel) claudeOptions.fallbackModel = cfg.fallbackModel;
          if (cfg.customSystemPrompt) claudeOptions.customSystemPrompt = cfg.customSystemPrompt;
          if (cfg.appendSystemPrompt) claudeOptions.appendSystemPrompt = cfg.appendSystemPrompt;
          if (cfg.additionalDirectories) claudeOptions.additionalDirectories = cfg.additionalDirectories;
          if (cfg.permissionMode) claudeOptions.permissionMode = cfg.permissionMode;
          if (cfg.maxThinkingTokens !== undefined && !Number.isNaN(cfg.maxThinkingTokens)) claudeOptions.maxThinkingTokens = cfg.maxThinkingTokens;
          if (cfg.allowedTools && (!claudeOptions.allowedTools || claudeOptions.allowedTools.length === 0)) {
            claudeOptions.allowedTools = cfg.allowedTools;
          }
          if (cfg.disallowedTools) claudeOptions.disallowedTools = cfg.disallowedTools;
          if (cfg.strictMcpConfig) claudeOptions.strictMcpConfig = true;
          if (finalMaxTurns !== undefined && !Number.isNaN(finalMaxTurns)) {
            claudeOptions.maxTurns = finalMaxTurns;
          }
          
          const claudeResponse = claudeQuery({ 
            prompt: options.prompt, 
            options: claudeOptions 
          });

          // Stream Claude SDK messages and convert to our interface
          for await (const message of claudeResponse) {
            if (options.options.abortController?.signal.aborted) {
              break;
            }
            
            console.debug('[ACP] Received Claude message:', JSON.stringify(message, null, 2));
            
            // Convert SDK message to our ClaudeMessage interface
            if (message.type === 'assistant') {
              // Extract text content from Anthropic message
              interface TextBlock {
                type: 'text';
                text: string;
              }
              
              interface ContentBlock {
                type: string;
                text?: string;
              }
              
              const contentBlocks = message.message?.content as ContentBlock[];
              if (contentBlocks) {
                const content = contentBlocks
                  .filter((block: ContentBlock): block is TextBlock => block.type === 'text')
                  .map((block: TextBlock) => block.text)
                  .join('');
                  
                yield {
                  type: 'assistant',
                  content: content
                } as ClaudeMessage;
              }
            } else if (message.type === 'user' && 'text' in message) {
              // Handle user message echoes (usually from system init)
              const textMessage = message as unknown as { text: string };
              yield {
                type: 'assistant',
                content: `Echo: ${textMessage.text}`
              } as ClaudeMessage;
            } else if (message.type === 'system') {
              // Handle system messages from Claude Code SDK
              if ('subtype' in message && message.subtype === 'init') {
                // Skip init message, but log for debugging
                console.debug('[ACP] Received Claude Code init message');
              } else if ('text' in message) {
                const textMessage = message as unknown as { text: string };
                yield {
                  type: 'assistant',
                  content: textMessage.text
                } as ClaudeMessage;
              }
            } else if (message.type === 'result') {
              // Prevent duplicate content: only surface explicit error subtypes; ignore normal results
              if ('subtype' in message && typeof message.subtype === 'string') {
                const subtype = message.subtype;
                if (subtype.startsWith('error')) {
                  // Use the subtype as the error message since result property doesn't exist on this type
                  yield { type: 'error', error: subtype || 'Execution error occurred' } as ClaudeMessage;
                }
              }
              // Ignore non-error result messages to avoid duplicating assistant output
            } else {
              // Handle any other message types by trying to extract text content
              console.debug('[ACP] Unknown message type, attempting to extract text:', message.type);
              if ('text' in message) {
                const textMessage = message as unknown as { text: string };
                yield {
                  type: 'assistant', 
                  content: textMessage.text
                } as ClaudeMessage;
              } else if ('content' in message) {
                const contentMessage = message as unknown as { content: unknown };
                yield {
                  type: 'assistant',
                  content: String(contentMessage.content)
                } as ClaudeMessage;
              }
            }
          }
        } catch (error) {
          yield {
            type: 'error',
            error: error instanceof Error ? error.message : String(error)
          } as ClaudeMessage;
        }
      }
    };
  }

  private resolveClaudeCliPath(): string | null {
    try {
      const pkgJsonPath = require.resolve('@anthropic-ai/claude-code/package.json');
      const dir = path.dirname(pkgJsonPath);
      const cli = path.join(dir, 'cli.js');
      return cli;
    } catch {
      return null;
    }
  }

  private contentBlocksToString(blocks: ContentBlock[]): string {
    return blocks
      .map(block => {
        if (block.type === 'text') {
          return block.text;
        }
        return `[${block.type}]`;
      })
      .join('\n');
  }

  private async handleToolCall(session: Session, tool: ToolCall): Promise<void> {
    // Convert tool type to ACP kind
    const mapToolTypeToKind = (type: ToolCall['type']): 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other' => {
      switch (type) {
        case 'file_edit':
          return 'edit';
        case 'read':
          return 'read';
        case 'search':
          return 'search';
        case 'execute':
          return 'execute';
        case 'other':
        default:
          return 'other';
      }
    };

    // Send tool call update
    await this.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: tool.id,
        title: tool.name,
        status: 'in_progress',
        kind: mapToolTypeToKind(tool.type)
      }
    });
  }

  private async handlePermissionRequest(session: Session, tool: ToolCall): Promise<PermissionDecision> {
    // Use integrated PermissionManager
    return await this.permissionManager.checkPermission(tool, this, session.id);
  }

  private async sendClaudeMessage(sessionId: string, message: ClaudeMessage): Promise<void> {
    const text = message.content?.trim() || (message.error ? `Error: ${message.error}` : '');
    if (!text) return; // Avoid sending empty chunks

    await this.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text
        }
      }
    });
  }
}

// Configuration interface
interface AgentConfig {
  maxSessions: number;
  sessionTimeoutMs: number;
  debug: boolean;
  claudeApiKey?: string;
  enableSmartSearch: boolean;
  respectGitignore: boolean;
  maxTurns?: number;
  model?: string;
  fallbackModel?: string;
  customSystemPrompt?: string;
  appendSystemPrompt?: string;
  additionalDirectories?: string[];
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  allowedTools?: string[];
  disallowedTools?: string[];
  strictMcpConfig?: boolean;
  maxThinkingTokens?: number;
}

// Extended Claude Options interface for SDK
interface ExtendedClaudeOptions extends Options {
  model?: string;
  fallbackModel?: string;
  customSystemPrompt?: string;
  appendSystemPrompt?: string;
  additionalDirectories?: string[];
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  allowedTools?: string[];
  disallowedTools?: string[];
  strictMcpConfig?: boolean;
  maxThinkingTokens?: number;
  maxTurns?: number;
}

// Legacy exports for backward compatibility
export class ACPAgent extends ClaudeACPAgent {}

export interface AgentOptions {
  maxSessions?: number;
  sessionTimeoutMs?: number;
  debug?: boolean;
  claudeApiKey?: string;
  enableSmartSearch?: boolean;
  respectGitignore?: boolean;
}

export interface LocalAgentCapabilities {
  fileSystem: boolean;
  toolExecution: boolean;
  sessionManagement: boolean;
  permissionHandling: boolean;
}

export interface ToolDefinition {
  name: string;
  type: 'file_edit' | 'execute' | 'read' | 'search' | 'other';
  description: string;
  parameters: Record<string, unknown>;
}

export interface ResourceDefinition {
  uri: string;
  type: 'file' | 'directory' | 'url';
  mimeType?: string;
  metadata?: Record<string, unknown>;
}
