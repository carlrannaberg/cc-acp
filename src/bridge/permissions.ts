import { ACPClient, PermissionDecision, ToolCall } from '../utils/types.js';
import { PermissionOption, toolKindSchema } from '../protocol/schemas.js';

// Type definitions for permission system
interface ToolContent {
  tool: string;
  description: string;
  path?: string;
  operation?: string;
  command?: string;
  args?: Record<string, unknown>;
  pattern?: string;
  scope?: string;
}

interface PermissionResponse {
  outcome: {
    outcome: string;
    optionId?: string;
  };
}

/**
 * Permission handling for ACP agent operations with granular caching
 */
export class PermissionManager {
  private cache = new Map<string, PermissionDecision & { timestamp: number }>();
  private readonly CACHE_TTL = 300000; // 5 minutes
  private sessionContext: string = '';

  constructor(
    private acpClient?: ACPClient,
    private defaultSessionId?: string
  ) {}

  /**
   * Check permission for a tool call with comprehensive caching
   */
  async checkPermission(
    tool: ToolCall,
    client: ACPClient,
    sessionId: string
  ): Promise<PermissionDecision> {
    // Check cache first
    const cacheKey = this.getCacheKey(tool);
    const cached = this.cache.get(cacheKey);
    
    if (cached && this.isCacheValid(cached, tool)) {
      return cached;
    }
    
    // Build permission options based on tool type
    const options = this.buildPermissionOptions(tool);
    
    // Request permission from Zed
    try {
      const response = await client.requestPermission({
        sessionId,
        toolCall: {
          toolCallId: tool.id,
          title: tool.description,
          kind: this.mapToolKind(tool),
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: this.buildToolContentText(tool)
            }
          }]
        },
        options
      });
      
      // Process response and update cache
      const decision = this.processResponse(response);
      
      if (decision.scope === 'always' || decision.scope === 'never') {
        this.cache.set(cacheKey, { ...decision, timestamp: Date.now() });
      }
      
      return decision;
    } catch (error) {
      // Default to deny on error
      return { allowed: false, scope: 'never' };
    }
  }

  /**
   * Build permission options based on tool type
   */
  private buildPermissionOptions(tool: ToolCall): PermissionOption[] {
    const base: PermissionOption[] = [
      { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' as const },
      { optionId: 'deny_once', name: 'Deny', kind: 'reject_once' as const }
    ];
    
    switch (tool.type) {
      case 'file_edit':
        return [
          { optionId: 'allow_all_edits', name: 'Allow All Edits', kind: 'allow_always' as const },
          ...base,
          { optionId: 'deny_all_edits', name: 'Deny All Edits', kind: 'reject_always' as const }
        ];
      
      case 'execute':
        return [
          { optionId: 'allow_command', name: `Always Allow ${tool.command || 'command'}`, kind: 'allow_always' as const },
          ...base,
          { optionId: 'deny_command', name: `Always Deny ${tool.command || 'command'}`, kind: 'reject_always' as const }
        ];

      case 'read':
        return [
          { optionId: 'allow_all_reads', name: 'Allow All File Reads', kind: 'allow_always' as const },
          ...base
        ];

      case 'search':
        return [
          { optionId: 'allow_all_search', name: 'Allow All Search Operations', kind: 'allow_always' as const },
          ...base
        ];
      
      default:
        return base;
    }
  }

  /**
   * Generate unique cache key for tool based on type and parameters
   */
  private getCacheKey(tool: ToolCall): string {
    const baseKey = `${tool.type}:${tool.name}`;
    
    switch (tool.type) {
      case 'file_edit':
        return `${baseKey}:${tool.args?.path || ''}`;
      case 'execute':
        return `${baseKey}:${tool.command || ''}`;
      case 'read':
        return `${baseKey}:${tool.args?.file_path || ''}`;
      case 'search':
        return `${baseKey}:${tool.args?.pattern || ''}`;
      default:
        return baseKey;
    }
  }

  /**
   * Check if cached permission still applies
   */
  private isCacheValid(cached: PermissionDecision & { timestamp: number }, tool: ToolCall): boolean {
    // Check TTL first
    const now = Date.now();
    if (now - cached.timestamp > this.CACHE_TTL) {
      return false;
    }
    
    // Always valid for 'always' and 'never' scopes within TTL
    if (cached.scope === 'always' || cached.scope === 'never') {
      return true;
    }
    
    // 'once' permissions are valid only for current context
    return cached.cacheKey === this.sessionContext;
  }

  /**
   * Map tool to ACP kind
   */
  private mapToolKind(tool: ToolCall): 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other' {
    switch (tool.type) {
      case 'read':
        return 'read';
      case 'file_edit':
        return 'edit';
      case 'execute':
        return 'execute';
      case 'search':
        return 'search';
      default:
        return 'other';
    }
  }

  /**
   * Format tool parameters for permission dialog as text
   */
  private buildToolContentText(tool: ToolCall): string {
    const content = this.buildToolContent(tool);
    return `Tool: ${content.tool}\nDescription: ${content.description}${
      content.path ? `\nPath: ${content.path}` : ''
    }${
      content.command ? `\nCommand: ${content.command}` : ''
    }${
      content.pattern ? `\nPattern: ${content.pattern}` : ''
    }${
      content.operation ? `\nOperation: ${content.operation}` : ''
    }`;
  }

  /**
   * Format tool parameters for permission dialog
   */
  private buildToolContent(tool: ToolCall): ToolContent {
    const content: ToolContent = {
      tool: tool.name,
      description: tool.description
    };

    switch (tool.type) {
      case 'file_edit':
        content.path = tool.args?.path as string || 'unknown';
        content.operation = tool.args?.operation as string || 'edit';
        break;
      case 'execute':
        content.command = tool.command || 'unknown command';
        content.args = tool.args || {};
        break;
      case 'read':
        content.path = tool.args?.file_path as string || 'unknown';
        break;
      case 'search':
        content.pattern = tool.args?.pattern as string || 'unknown';
        content.scope = tool.args?.path as string || 'current directory';
        break;
    }

    return content;
  }

  /**
   * Convert ACP response to decision object
   */
  private processResponse(response: PermissionResponse): PermissionDecision {
    const { outcome } = response.outcome;

    // Treat cancelled as a deny-once for safety
    if (outcome === 'cancelled') {
      return {
        allowed: false,
        scope: 'once',
        cacheKey: this.sessionContext
      };
    }

    // Derive decision strictly from selected optionId
    const optionId = response.outcome.optionId;
    let allowed = false;
    let scope: 'once' | 'always' | 'never' = 'once';

    switch (optionId) {
      case 'allow_once':
        allowed = true;
        scope = 'once';
        break;
      case 'allow_all_edits':
      case 'allow_command':
      case 'allow_all_reads':
      case 'allow_all_search':
        allowed = true;
        scope = 'always';
        break;
      case 'deny_once':
        allowed = false;
        scope = 'once';
        break;
      case 'deny_all_edits':
      case 'deny_command':
        allowed = false;
        scope = 'never';
        break;
      default:
        // Unknown option: deny-once by default
        allowed = false;
        scope = 'once';
        break;
    }

    return {
      allowed,
      scope,
      cacheKey: this.sessionContext
    };
  }

  /**
   * Clear permission cache when needed
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Invalidate specific cached permissions
   */
  invalidateCache(pattern: string): void {
    for (const [key] of this.cache) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Update session context for cache validation
   */
  updateContext(context: string): void {
    this.sessionContext = context;
    
    // Clear 'once' permissions when context changes
    for (const [key, permission] of this.cache) {
      if (permission.scope === 'once') {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cached permission count for monitoring
   */
  getCacheStats(): { total: number; always: number; never: number; once: number } {
    const stats = { total: 0, always: 0, never: 0, once: 0 };
    
    for (const permission of this.cache.values()) {
      stats.total++;
      stats[permission.scope]++;
    }
    
    return stats;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.clearCache();
  }
}

