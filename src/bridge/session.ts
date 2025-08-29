import { randomUUID } from 'crypto';
import { ACPFileSystem } from '../files/filesystem.js';
import { FileResolver } from '../files/resolver.js';
import { 
  ClaudeSDK, 
  Config, 
  FileSystemService, 
  ACPClient,
  Message,
  PermissionDecision,
  ToolCall,
  ToolResult,
  ContentBlock,
  ResolvedContent,
  ClaudeMessage
} from '../utils/types.js';
import { PromptRequest, PromptResponse } from '../protocol/schemas.js';
import { PermissionManager } from './permissions.js';
import { StreamBuffer, globalMemoryManager } from '../utils/performance.js';

// Interface for agent with permission manager access
interface ACPClientWithPermissions extends ACPClient {
  permissionManager?: PermissionManager;
}

/**
 * Session management for ACP connections with performance monitoring
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private maxSessions: number;
  private sessionTimeoutMs: number;
  private cleanupInterval: NodeJS.Timeout;
  
  // Performance monitoring
  private memoryStats = {
    maxMemoryMB: 512,
    lastMemoryCheck: Date.now(),
    memoryCheckInterval: 30000 // 30 seconds
  };

  constructor(options: SessionManagerOptions = {}) {
    this.maxSessions = options.maxSessions ?? 10;
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? 3600000; // 1 hour
    
    // Set up periodic cleanup of expired sessions
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
      this.checkMemoryUsage();
    }, 300000); // 5 minutes
  }

  async createSession(
    sessionId: string,
    config: Config,
    fileSystemService: FileSystemService,
    claudeSDK: ClaudeSDK,
    acpClient: ACPClient
  ): Promise<Session> {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Maximum sessions limit reached (${this.maxSessions})`);
    }

    if (this.sessions.has(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`);
    }

    const session = new Session(sessionId, {
      config,
      fileSystemService,
      claudeSDK,
      acpClient,
      sessionTimeoutMs: this.sessionTimeoutMs
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updateLastUsed();
    }
    return session || null;
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.dispose();
      this.sessions.delete(sessionId);
    }
  }

  async destroyAllSessions(): Promise<void> {
    const destroyPromises = Array.from(this.sessions.keys()).map(
      sessionId => this.destroySession(sessionId)
    );
    await Promise.all(destroyPromises);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  dispose(): void {
    clearInterval(this.cleanupInterval);
    // Note: Sessions are cleaned up by destroyAllSessions()
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (session.isExpired(now)) {
        this.destroySession(sessionId).catch(error => {
          console.error(`Failed to cleanup expired session ${sessionId}:`, error);
        });
      }
    }
  }
  
  /**
   * Monitor memory usage and trigger cleanup if needed
   */
  private checkMemoryUsage(): void {
    const now = Date.now();
    if (now - this.memoryStats.lastMemoryCheck < this.memoryStats.memoryCheckInterval) {
      return;
    }
    
    this.memoryStats.lastMemoryCheck = now;
    
    const memoryUsage = process.memoryUsage();
    const memoryUsedMB = memoryUsage.heapUsed / (1024 * 1024);
    
    if (memoryUsedMB > this.memoryStats.maxMemoryMB) {
      console.warn(`High memory usage: ${memoryUsedMB.toFixed(1)}MB, triggering cleanup`);
      this.performMemoryCleanup();
    }
  }
  
  /**
   * Aggressive memory cleanup when usage is high
   */
  private performMemoryCleanup(): void {
    // Clear oldest sessions first
    const sessionsSorted = Array.from(this.sessions.entries())
      .sort(([, a], [, b]) => a.lastUsed.getTime() - b.lastUsed.getTime());
    
    // Remove up to half of the sessions if memory is critical
    const sessionsToRemove = sessionsSorted.slice(0, Math.ceil(sessionsSorted.length / 2));
    
    for (const [sessionId] of sessionsToRemove) {
      this.destroySession(sessionId).catch(error => {
        console.error(`Failed to cleanup session during memory cleanup ${sessionId}:`, error);
      });
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }
}

/**
 * Individual session handling and state management with backpressure and memory optimization
 */
export class Session {
  public readonly config: Config;
  public readonly fileSystem: ACPFileSystem;
  public readonly claudeSDK: ClaudeSDK;
  
  private acpClient: ACPClient;
  private createdAt: Date;
  public lastUsed: Date; // Make public for session manager access
  private sessionTimeoutMs: number;
  private abortController?: AbortController;
  private disposed = false;
  
  // Session management state
  private conversationHistory: Message[] = [];
  private pendingPrompt: AbortController | null = null;
  private fileResolver: FileResolver;
  
  // Backpressure handling for streams
  private streamBuffer: unknown[] = [];
  private readonly STREAM_BUFFER_SIZE = 100;
  private readonly STREAM_FLUSH_INTERVAL = 100; // ms
  private streamFlushTimer: NodeJS.Timeout | null = null;
  
  // Memory management
  private readonly MAX_CONVERSATION_HISTORY = 50;
  private readonly MAX_MEMORY_MB = 128; // Per session limit

  constructor(
    public readonly id: string,
    options: SessionOptions
  ) {
    this.config = options.config;
    this.claudeSDK = options.claudeSDK;
    this.acpClient = options.acpClient;
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? 3600000;
    
    this.createdAt = new Date();
    this.lastUsed = new Date();

    // Create filesystem with ACP integration
    this.fileSystem = new ACPFileSystem(
      this.acpClient,
      this.id,
      options.fileSystemService
    );
    
    // Initialize file resolver for smart content resolution
    this.fileResolver = new FileResolver(this.config, options.fileSystemService);
  }

  /**
   * Main prompt handling method with conversation history and tool execution
   */
  async prompt(request: PromptRequest): Promise<PromptResponse> {
    // Cancel any pending prompt
    this.pendingPrompt?.abort();
    this.pendingPrompt = new AbortController();
    
    try {
      this.updateLastUsed();
      
      // Resolve files with smart search - CRITICAL FIX: request.prompt is already ContentBlock[]
      const resolved = await this.fileResolver.resolvePrompt(
        request.prompt,
        this.pendingPrompt.signal
      );
      
      // Build prompt with conversation context
      const prompt = this.buildPromptWithContext(resolved);
      
      // CRITICAL FIX: Normalize message storage format for consistency
      this.conversationHistory.push({
        role: 'user',
        content: request.prompt, // Store as ContentBlock[] to maintain consistency
        timestamp: new Date()
      });
      
      // Stream from Claude SDK
      const stream = await this.claudeSDK.query({
        prompt,
        options: {
          abortController: this.pendingPrompt,
          conversationId: this.id,
          onToolCall: (tool) => this.handleToolCall(tool),
          permissionMode: 'custom',
          permissionHandler: (tool) => this.checkPermission(tool),
          maxTurns: 10,
          allowedTools: ['file_edit', 'execute', 'read', 'search']
        }
      });
      
      // Process stream with backpressure handling
      const assistantContentBlocks: ContentBlock[] = [];
      for await (const chunk of stream) {
        if (this.pendingPrompt.signal.aborted) {
          // CRITICAL FIX: Clean up state on cancellation
          await this.cleanupErrorState('Operation was cancelled');
          return { stopReason: 'cancelled' };
        }
        
        const processed = await this.processChunk(chunk);
        if (processed.contentBlock) {
          assistantContentBlocks.push(processed.contentBlock);
        }
      }
      
      // CRITICAL FIX: Store assistant response in same format as user messages
      if (assistantContentBlocks.length > 0) {
        this.conversationHistory.push({
          role: 'assistant',
          content: assistantContentBlocks,
          timestamp: new Date()
        });
      }
      
      return { stopReason: 'end_turn' };
      
    } catch (error: unknown) {
      if ((error as Error)?.name === 'AbortError' || this.pendingPrompt?.signal.aborted) {
        await this.cleanupErrorState('Operation was cancelled');
        return { stopReason: 'cancelled' };
      }
      
      // CRITICAL FIX: Enhanced error recovery with state cleanup
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Session ${this.id} prompt error:`, errorMessage);
      
      // Clean up state and notify client
      await this.recoverFromError(errorMessage);
      
      throw error;
    } finally {
      this.pendingPrompt = null;
      
      // Memory management after each prompt
      this.manageConversationMemory();
      this.checkSessionMemory();
      
      // Flush any remaining stream updates
      await this.flushStreamBuffer();
    }
  }

  /**
   * Handle tool calls with permission checks and execution
   */
  private async handleToolCall(tool: ToolCall): Promise<void> {
    const callId = `${tool.name}-${Date.now()}`;
    
    try {
      // Send initial tool call notification
      await this.acpClient.sessionUpdate({
        sessionId: this.id,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: callId,
          title: tool.description,
          status: 'pending',
          kind: this.mapToolKind(tool.name),
          content: this.buildToolContent(tool)
        }
      });
      
      // Check permissions with caching
      const permission = await this.checkPermission(tool);
      
      if (permission.allowed) {
        // Execute tool
        await this.acpClient.sessionUpdate({
          sessionId: this.id,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: callId,
            status: 'in_progress'
          }
        });
        
        const result = await tool.execute();
        
        // Send completion update
        await this.acpClient.sessionUpdate({
          sessionId: this.id,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: callId,
            status: 'completed',
            content: this.formatToolResult(result)
          }
        });
      } else {
        // Tool rejected
        await this.acpClient.sessionUpdate({
          sessionId: this.id,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: callId,
            status: 'failed',
            content: [{ type: 'content', content: { type: 'text', text: 'Permission denied by user' } }]
          }
        });
      }
    } catch (error) {
      // Send error update for failed tool call
      await this.acpClient.sessionUpdate({
        sessionId: this.id,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: callId,
          status: 'failed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
            }
          }]
        }
      }).catch(() => {}); // Ignore session update errors
      
      console.error(`Tool call ${callId} failed:`, error);
    }
  }

  /**
   * Build prompt with conversation context
   * CRITICAL FIX: Handle ContentBlock[] format consistently
   */
  private buildPromptWithContext(resolved: ResolvedContent[]): string {
    let prompt = '';
    
    // Add conversation history context (last 10 messages for token efficiency)
    const recentHistory = this.conversationHistory.slice(-10);
    if (recentHistory.length > 0) {
      prompt += '\n--- Conversation History ---\n';
      for (const message of recentHistory) {
        const contentStr = this.formatMessageContent(message.content);
        prompt += `${message.role}: ${contentStr}\n`;
      }
      prompt += '--- End History ---\n\n';
    }
    
    // Add resolved content
    for (const content of resolved) {
      if (content.type === 'file' && content.path && content.content) {
        prompt += `--- File: ${content.path} ---\n${content.content}\n--- End File ---\n\n`;
      } else if (content.type === 'content' && content.block) {
        if (content.block.type === 'text') {
          prompt += content.block.text + '\n\n';
        } else if (content.block.type === 'resource_link') {
          prompt += `Resource: ${content.block.name || content.block.uri}\n\n`;
        } else {
          prompt += `[${content.block.type} content]\n\n`;
        }
      } else if (content.type === 'error' && content.message) {
        prompt += `Error: ${content.message}\n\n`;
      }
    }
    
    return prompt;
  }

  /**
   * CRITICAL FIX: Helper method to format message content consistently
   */
  private formatMessageContent(content: string | ContentBlock[]): string {
    if (Array.isArray(content)) {
      return content.map(block => {
        switch (block.type) {
          case 'text':
            return block.text;
          case 'resource_link':
            return `[File: ${block.name || block.uri}]`;
          case 'image':
            return '[Image]';
          case 'audio':
            return '[Audio]';
          case 'resource':
            return '[Resource]';
          default:
            // Handle any unexpected content block types
            return `[${(block as any).type || 'unknown'}]`;
        }
      }).join(' ');
    }
    return content;
  }

  /**
   * Process streaming chunks with backpressure handling
   * CRITICAL FIX: Handle both string and ContentBlock[] content formats
   */
  private async processChunk(chunk: ClaudeMessage): Promise<{ contentBlock?: ContentBlock; content?: string }> {
    try {
      if (chunk.type === 'assistant' && chunk.content) {
        // Create ContentBlock from string content
        const contentBlock: ContentBlock = {
          type: 'text',
          text: chunk.content
        };
        
        // Use buffered sending for backpressure control
        await this.bufferStreamUpdate({
          sessionId: this.id,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: contentBlock
          }
        });
        
        return { contentBlock, content: chunk.content };
      }
      
      if (chunk.type === 'error' && chunk.error) {
        const errorContentBlock: ContentBlock = {
          type: 'text',
          text: `Error: ${chunk.error}`
        };
        
        await this.bufferStreamUpdate({
          sessionId: this.id,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: errorContentBlock
          }
        });
        
        return { contentBlock: errorContentBlock };
      }
      
      return {};
    } catch (error) {
      console.error(`Error processing chunk in session ${this.id}:`, error);
      return {};
    }
  }
  
  /**
   * Buffer stream updates for backpressure handling
   */
  private async bufferStreamUpdate(update: Parameters<ACPClient['sessionUpdate']>[0]): Promise<void> {
    this.streamBuffer.push(update);
    
    if (this.streamBuffer.length >= this.STREAM_BUFFER_SIZE) {
      await this.flushStreamBuffer();
    } else if (!this.streamFlushTimer) {
      this.streamFlushTimer = setTimeout(() => this.flushStreamBuffer(), this.STREAM_FLUSH_INTERVAL);
    }
  }
  
  /**
   * Flush buffered stream updates
   */
  private async flushStreamBuffer(): Promise<void> {
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
      this.streamFlushTimer = null;
    }
    
    const updates = this.streamBuffer.splice(0) as Parameters<ACPClient['sessionUpdate']>[0][];
    if (updates.length === 0) return;
    
    // Send all buffered updates
    for (const update of updates) {
      try {
        await this.acpClient.sessionUpdate(update);
      } catch (error) {
        console.error(`Failed to send buffered update:`, error);
      }
    }
  }

  /**
   * Map tool names to ACP tool kinds
   */
  private mapToolKind(toolName: string): 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other' {
    const toolKindMap: Record<string, 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other'> = {
      'file_edit': 'edit',
      'file_read': 'read', 
      'file_write': 'edit',
      'file_search': 'search',
      'execute': 'execute',
      'bash': 'execute',
      'grep': 'search',
      'glob': 'search',
      'read': 'read'
    };
    
    return toolKindMap[toolName] || 'other';
  }

  /**
   * Build tool content for display
   */
  private buildToolContent(tool: ToolCall): Array<{ type: 'content', content: ContentBlock } | { type: 'diff', path: string, oldText?: string | null, newText: string }> {
    const content: Array<{ type: 'content', content: ContentBlock }> = [];
    
    // Add tool description
    content.push({
      type: 'content',
      content: {
        type: 'text',
        text: tool.description || `Executing ${tool.name}`
      }
    });
    
    // Add command if available
    if (tool.command) {
      content.push({
        type: 'content',
        content: {
          type: 'text', 
          text: `Command: ${tool.command}`
        }
      });
    }
    
    // Add arguments if available
    if (tool.args && Object.keys(tool.args).length > 0) {
      content.push({
        type: 'content',
        content: {
          type: 'text',
          text: `Arguments: ${JSON.stringify(tool.args, null, 2)}`
        }
      });
    }
    
    return content;
  }

  /**
   * Format tool execution results
   */
  private formatToolResult(result: ToolResult): Array<{ type: 'content', content: ContentBlock } | { type: 'diff', path: string, oldText?: string | null, newText: string }> {
    const content: Array<{ type: 'content', content: ContentBlock } | { type: 'diff', path: string, oldText?: string | null, newText: string }> = [];
    
    if (result.success) {
      if (result.output) {
        content.push({
          type: 'content',
          content: {
            type: 'text',
            text: result.output
          }
        });
      }
      
      if (result.files && result.files.length > 0) {
        content.push({
          type: 'content',
          content: {
            type: 'text',
            text: `Files affected: ${result.files.join(', ')}`
          }
        });
      }
      
      if (result.diff) {
        content.push({
          type: 'diff',
          path: result.diff.path,
          oldText: result.diff.oldText,
          newText: result.diff.newText
        });
      }
    } else {
      content.push({
        type: 'content',
        content: {
          type: 'text',
          text: `Error: ${result.error || 'Unknown error occurred'}`
        }
      });
    }
    
    return content;
  }

  /**
   * CRITICAL FIX: Clean up state on error/cancellation
   */
  private async cleanupErrorState(reason: string): Promise<void> {
    try {
      // Cancel any pending operations
      if (this.pendingPrompt && !this.pendingPrompt.signal.aborted) {
        this.pendingPrompt.abort();
      }
      
      // Permission cache is now managed by PermissionManager
      // Clear context in agent's permission manager if available
      const agent = this.acpClient as ACPClientWithPermissions;
      if (agent.permissionManager) {
        agent.permissionManager.clearCache();
      }
      
      // Notify client of cleanup
      await this.acpClient.sessionUpdate({
        sessionId: this.id,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: `Session state cleaned up: ${reason}`
          }
        }
      }).catch(() => {}); // Ignore notification errors during cleanup
      
    } catch (error) {
      console.error(`Error during state cleanup for session ${this.id}:`, error);
    }
  }

  /**
   * CRITICAL FIX: Recover from errors with comprehensive state management
   */
  private async recoverFromError(errorMessage: string): Promise<void> {
    try {
      // Perform state cleanup
      await this.cleanupErrorState(`Error recovery: ${errorMessage}`);
      
      // Send error notification to client
      await this.acpClient.sessionUpdate({
        sessionId: this.id,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: `Error processing prompt: ${errorMessage}. Session recovered.`
          }
        }
      }).catch(() => {}); // Ignore session update errors during recovery
      
      // Reset session state for next operation
      this.pendingPrompt = null;
      
    } catch (recoveryError) {
      console.error(`Error during recovery for session ${this.id}:`, recoveryError);
    }
  }

  /**
   * Check permissions using integrated PermissionManager
   */
  private async checkPermission(tool: ToolCall): Promise<PermissionDecision> {
    // Use PermissionManager from agent for centralized permission handling
    const agent = this.acpClient as ACPClientWithPermissions;
    if (agent.permissionManager) {
      return await agent.permissionManager.checkPermission(tool, this.acpClient, this.id);
    }
    
    // Fallback to simple permission logic if PermissionManager not available
    return {
      allowed: true,
      scope: 'once',
      tool: tool.name,
      command: tool.command
    };
  }

  /**
   * Cancel current prompt execution
   */
  cancel(): void {
    if (this.pendingPrompt && !this.pendingPrompt.signal.aborted) {
      this.pendingPrompt.abort();
    }
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }
  }

  updateLastUsed(): void {
    if (!this.disposed) {
      this.lastUsed = new Date();
    }
  }

  isExpired(currentTime?: number): boolean {
    const now = currentTime ?? Date.now();
    const elapsed = now - this.lastUsed.getTime();
    return elapsed > this.sessionTimeoutMs;
  }

  getAbortController(): AbortController {
    if (!this.abortController || this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }
    return this.abortController;
  }

  getAge(): number {
    return Date.now() - this.createdAt.getTime();
  }

  getIdleTime(): number {
    return Date.now() - this.lastUsed.getTime();
  }

  /**
   * Get conversation history (useful for debugging and state inspection)
   */
  getConversationHistory(): Message[] {
    return [...this.conversationHistory];
  }

  /**
   * Clear conversation history (useful for privacy or memory management)
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }
  
  /**
   * Manage conversation history size for memory efficiency
   */
  private manageConversationMemory(): void {
    if (this.conversationHistory.length > this.MAX_CONVERSATION_HISTORY) {
      // Keep only the most recent messages
      const toKeep = Math.floor(this.MAX_CONVERSATION_HISTORY * 0.8);
      this.conversationHistory = this.conversationHistory.slice(-toKeep);
    }
  }
  
  /**
   * Check session memory usage
   */
  private checkSessionMemory(): void {
    const memoryUsage = process.memoryUsage();
    const sessionMemoryMB = memoryUsage.heapUsed / (1024 * 1024);
    
    if (sessionMemoryMB > this.MAX_MEMORY_MB) {
      // Aggressive cleanup
      this.conversationHistory = this.conversationHistory.slice(-10);
      
      // Clear file resolver cache
      this.fileResolver.clearCache();
      
      if (global.gc) {
        global.gc();
      }
    }
  }

  toJSON() {
    return {
      id: this.id,
      config: this.config,
      createdAt: this.createdAt.toISOString(),
      lastUsed: this.lastUsed.toISOString(),
      age: this.getAge(),
      idleTime: this.getIdleTime(),
      disposed: this.disposed,
      conversationLength: this.conversationHistory.length,
      permissionsCached: 0 // Now managed by PermissionManager
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    
    this.disposed = true;
    this.cancel();
    
    // Flush any pending stream updates
    await this.flushStreamBuffer();
    
    // Clear timers
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
      this.streamFlushTimer = null;
    }
    
    // Clear caches and memory
    this.conversationHistory = [];
    this.streamBuffer = [];
    this.fileResolver.clearCache();
    
    // Clean up resources
    if (this.fileSystem && typeof this.fileSystem.dispose === 'function') {
      await this.fileSystem.dispose();
    }
  }
}

export interface SessionManagerOptions {
  maxSessions?: number;
  sessionTimeoutMs?: number;
}

export interface SessionOptions {
  config: Config;
  fileSystemService: FileSystemService;
  claudeSDK: ClaudeSDK;
  acpClient: ACPClient;
  sessionTimeoutMs?: number;
}

