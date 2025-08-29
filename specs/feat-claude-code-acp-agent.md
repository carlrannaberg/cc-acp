# Claude Code ACP Agent for Zed Editor - Realistic Specification

## Status
Draft - Production-Ready Design

## Authors
Claude Code Assistant  
Date: 2025-08-29

## Overview
A production-quality bridge that enables Claude Code to run as an external agent within Zed Editor via the Agent Client Protocol (ACP). Based on learnings from Gemini CLI's implementation, this specification provides a realistic architecture that balances simplicity with necessary complexity for a good user experience.

## Problem Statement
Zed Editor supports external AI agents through ACP. Claude Code provides powerful AI assistance but lacks Zed integration. Users need a reliable, feature-complete bridge that handles real-world complexity while maintaining good performance and user experience.

## Goals
- **Core Functionality**
  - Enable Claude Code text and image prompts from within Zed
  - Stream responses with proper backpressure handling
  - Support conversation context and history
  - Handle cancellation and error recovery gracefully

- **File Handling**
  - Smart file resolution with glob patterns
  - Directory expansion and recursive search
  - Respect gitignore patterns
  - Access unsaved buffer content via ACP filesystem

- **Permission System**
  - Granular permission controls (allow once/always/per-tool)
  - Clear permission dialogs with context
  - Permission caching per session

- **Production Quality**
  - Comprehensive error handling with actionable messages
  - Proper JSON-RPC protocol implementation
  - Complete message validation
  - Session state management

## Non-Goals
- MCP server infrastructure (direct permissions instead)
- Session persistence across restarts (can be added later)
- Audio content support (not critical for code assistance)
- Custom authentication (use Claude Code SDK's built-in auth)

## Technical Dependencies
- **@zed-industries/agent-client-protocol**: `^0.1.2` - ACP TypeScript library
- **@anthropic-ai/claude-code**: `^1.0.96` - Claude Code SDK
- **zod**: `^3.22.0` - Schema validation (critical for protocol compliance)
- **Node.js 18+** - Required by Claude Code SDK
- **TypeScript 5.0+** - For development

## Architecture

### Realistic Component Design

```
┌─────────────────┐    JSON-RPC/stdio    ┌──────────────────────┐
│   Zed Editor    │◄──────────────────────►│  Claude ACP Bridge   │
│                 │                       │                      │
│ • UI Controls   │                       │ ┌──────────────────┐ │
│ • File Buffers  │                       │ │ Protocol Layer   │ │
│ • Permissions   │                       │ │ • JSON-RPC       │ │
└─────────────────┘                       │ │ • Validation     │ │
                                          │ │ • Queue Mgmt     │ │
                                          │ └──────────────────┘ │
                                          │                      │
                                          │ ┌──────────────────┐ │
                                          │ │ Session Manager  │ │
                                          │ │ • State Tracking │ │
                                          │ │ • History        │ │
                                          │ │ • Cancellation   │ │
                                          │ └──────────────────┘ │
                                          │                      │
                                          │ ┌──────────────────┐ │
                                          │ │ File Resolver    │ │
                                          │ │ • Smart Search   │ │
                                          │ │ • Glob Patterns  │ │
                                          │ │ • Buffer Access  │ │
                                          │ └──────────────────┘ │
                                          │                      │
                                          │ ┌──────────────────┐ │
                                          │ │ Claude SDK       │ │
                                          │ │ Integration      │ │
                                          │ └──────────────────┘ │
                                          └──────────────────────┘
```

### Module Structure

```
src/
├── index.ts              # Entry point (~50 lines)
├── protocol/
│   ├── connection.ts     # JSON-RPC handling (~400 lines)
│   └── schemas.ts        # Zod message schemas (~300 lines)
├── bridge/
│   ├── agent.ts          # Main ACP agent (~300 lines)
│   ├── session.ts        # Session management (~400 lines)
│   └── permissions.ts    # Permission handling (~150 lines)
├── files/
│   ├── resolver.ts       # Smart file resolution (~300 lines)
│   └── filesystem.ts     # ACP filesystem proxy (~100 lines)
└── utils/
    ├── errors.ts         # Error handling (~100 lines)
    └── types.ts          # TypeScript types (~100 lines)
```

**Realistic Total: ~2,200 lines of production code**

## Implementation Details

### 1. Protocol Layer (Based on Gemini's Approach)

**File: `src/protocol/connection.ts`**

Robust JSON-RPC implementation with proper message handling:

```typescript
export class Connection {
  private pendingResponses = new Map<string | number, PendingResponse>();
  private nextRequestId = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  
  constructor(
    private handler: MethodHandler,
    private input: WritableStream<Uint8Array>,
    private output: ReadableStream<Uint8Array>
  ) {
    this.receive();
  }

  private async receive(): Promise<void> {
    let buffer = '';
    const decoder = new TextDecoder();
    
    for await (const chunk of this.output) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            await this.processMessage(message);
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        }
      }
    }
  }

  private async processMessage(message: AnyMessage): Promise<void> {
    if ('method' in message && 'id' in message) {
      // Request - call handler and send response
      const result = await this.tryCallHandler(message.method, message.params);
      await this.sendMessage({
        jsonrpc: '2.0',
        id: message.id,
        ...result
      });
    } else if ('method' in message) {
      // Notification - call handler without response
      await this.tryCallHandler(message.method, message.params);
    } else if ('id' in message) {
      // Response - resolve pending request
      this.handleResponse(message);
    }
  }

  // Queued writes to prevent message interleaving
  private async sendMessage(message: unknown): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const writer = this.input.getWriter();
      try {
        const data = JSON.stringify(message) + '\n';
        await writer.write(new TextEncoder().encode(data));
      } finally {
        writer.releaseLock();
      }
    }).catch(error => {
      console.error('Write error:', error);
    });
    
    return this.writeQueue;
  }
}
```

### 2. Schema Validation (Critical for Protocol Compliance)

**File: `src/protocol/schemas.ts`**

Comprehensive Zod schemas for all message types:

```typescript
import { z } from 'zod';

// Content types with strict validation
export const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
    annotations: annotationsSchema.optional()
  }),
  z.object({
    type: z.literal('image'),
    data: z.string(), // base64
    mimeType: z.string(),
    annotations: annotationsSchema.optional()
  }),
  z.object({
    type: z.literal('resource_link'),
    uri: z.string().url(),
    name: z.string(),
    mimeType: z.string().optional(),
    annotations: annotationsSchema.optional()
  })
]);

// Session updates with all variants
export const sessionUpdateSchema = z.discriminatedUnion('sessionUpdate', [
  z.object({
    sessionUpdate: z.literal('agent_message_chunk'),
    content: contentBlockSchema
  }),
  z.object({
    sessionUpdate: z.literal('tool_call'),
    toolCallId: z.string(),
    title: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
    kind: z.enum(['read', 'edit', 'execute', 'search', 'other']),
    content: z.array(toolCallContentSchema).optional()
  }),
  // ... other variants
]);

// Request/response validation
export const promptRequestSchema = z.object({
  sessionId: z.string().uuid(),
  prompt: z.array(contentBlockSchema)
});
```

### 3. Smart File Resolution (Learning from Gemini)

**File: `src/files/resolver.ts`**

Intelligent file handling with fallback strategies:

```typescript
export class FileResolver {
  constructor(
    private config: Config,
    private fileSystem: FileSystemService
  ) {}

  async resolvePrompt(
    content: ContentBlock[],
    signal: AbortSignal
  ): Promise<ResolvedContent[]> {
    const resolved: ResolvedContent[] = [];
    
    for (const block of content) {
      if (block.type === 'resource_link' && block.uri.startsWith('file://')) {
        const path = block.uri.slice(7); // Remove file://
        
        try {
          // Try direct file access first
          const resolvedPath = await this.resolvePath(path);
          resolved.push({
            type: 'file',
            path: resolvedPath,
            content: await this.fileSystem.readFile(resolvedPath)
          });
        } catch (error) {
          if (error.code === 'ENOENT' && this.config.enableSmartSearch) {
            // Fallback to glob search
            const matches = await this.globSearch(`**/*${path}*`, signal);
            if (matches.length > 0) {
              // Use best match (could be fuzzy matched)
              const bestMatch = this.selectBestMatch(path, matches);
              resolved.push({
                type: 'file',
                path: bestMatch,
                content: await this.fileSystem.readFile(bestMatch)
              });
            } else {
              // File not found - provide helpful error
              resolved.push({
                type: 'error',
                message: `File not found: ${path}. Similar files: ${await this.suggestSimilar(path)}`
              });
            }
          }
        }
      } else {
        resolved.push({ type: 'content', block });
      }
    }
    
    return resolved;
  }

  private async resolvePath(path: string): Promise<string> {
    const absolute = path.isAbsolute() ? path : path.resolve(this.config.cwd, path);
    
    // Check if it's a directory
    const stats = await fs.stat(absolute);
    if (stats.isDirectory()) {
      // Expand to glob pattern
      return `${path}/**/*`;
    }
    
    // Validate within project bounds
    if (!isWithinRoot(absolute, this.config.cwd)) {
      throw new Error(`Path outside project: ${path}`);
    }
    
    return absolute;
  }
  
  private async globSearch(pattern: string, signal: AbortSignal): Promise<string[]> {
    // Smart glob search with gitignore respect
    const results = await glob(pattern, {
      cwd: this.config.cwd,
      ignore: this.config.respectGitignore ? await this.getGitignorePatterns() : [],
      signal
    });
    
    return results;
  }
}
```

### 4. Session Management with State

**File: `src/bridge/session.ts`**

Stateful sessions with conversation history and proper lifecycle:

```typescript
export class Session {
  private conversationHistory: Message[] = [];
  private pendingPrompt: AbortController | null = null;
  private permissionCache = new Map<string, PermissionDecision>();
  
  constructor(
    private id: string,
    private config: Config,
    private client: ACPClient,
    private claudeSDK: ClaudeSDK
  ) {}

  async prompt(request: PromptRequest): Promise<PromptResponse> {
    // Cancel any pending prompt
    this.pendingPrompt?.abort();
    this.pendingPrompt = new AbortController();
    
    try {
      // Resolve files with smart search
      const resolved = await this.fileResolver.resolvePrompt(
        request.prompt,
        this.pendingPrompt.signal
      );
      
      // Build prompt with conversation context
      const prompt = this.buildPromptWithContext(resolved);
      
      // Stream from Claude SDK
      const stream = await this.claudeSDK.query({
        prompt,
        options: {
          abortController: this.pendingPrompt,
          conversationId: this.id,
          onToolCall: (tool) => this.handleToolCall(tool),
          permissionMode: 'custom',
          permissionHandler: (tool) => this.checkPermission(tool)
        }
      });
      
      // Process stream with backpressure handling
      for await (const chunk of stream) {
        await this.processChunk(chunk);
      }
      
      return { stopReason: 'end_turn' };
      
    } catch (error) {
      if (error.name === 'AbortError') {
        return { stopReason: 'cancelled' };
      }
      throw error;
    } finally {
      this.pendingPrompt = null;
    }
  }

  private async handleToolCall(tool: ToolCall): Promise<void> {
    const callId = `${tool.name}-${Date.now()}`;
    
    // Send initial tool call notification
    await this.client.sessionUpdate({
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
      await this.client.sessionUpdate({
        sessionId: this.id,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: callId,
          status: 'in_progress'
        }
      });
      
      const result = await tool.execute();
      
      // Send completion update
      await this.client.sessionUpdate({
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
      await this.client.sessionUpdate({
        sessionId: this.id,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: callId,
          status: 'failed',
          content: [{ type: 'text', text: 'Permission denied by user' }]
        }
      });
    }
  }
}
```

### 5. Granular Permission System

**File: `src/bridge/permissions.ts`**

Sophisticated permission handling with caching:

```typescript
export class PermissionManager {
  private cache = new Map<string, PermissionDecision>();
  
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
    const response = await client.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: tool.id,
        title: tool.description,
        kind: this.mapToolKind(tool),
        content: this.buildToolContent(tool)
      },
      options
    });
    
    // Process response and update cache
    const decision = this.processResponse(response);
    
    if (decision.scope === 'always') {
      this.cache.set(cacheKey, decision);
    }
    
    return decision;
  }
  
  private buildPermissionOptions(tool: ToolCall): PermissionOption[] {
    const base = [
      { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'deny_once', name: 'Deny', kind: 'reject_once' }
    ];
    
    switch (tool.type) {
      case 'file_edit':
        return [
          { optionId: 'allow_all_edits', name: 'Allow All Edits', kind: 'allow_always' },
          ...base
        ];
      
      case 'execute':
        return [
          { optionId: 'allow_command', name: `Always Allow ${tool.command}`, kind: 'allow_always' },
          ...base
        ];
      
      default:
        return base;
    }
  }
}
```

## Error Handling Strategy

### Comprehensive Error Recovery

```typescript
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
    }
    
    // Generic error with helpful context
    return {
      code: -32603, // Internal error
      message: error instanceof Error ? error.message : 'Unknown error',
      data: { 
        stack: process.env.DEBUG ? error.stack : undefined 
      }
    };
  }
}
```

## Testing Strategy

### Realistic Testing Approach

**Focus on Integration and E2E Tests**

```typescript
// tests/integration/protocol.test.ts
describe('ACP Protocol Integration', () => {
  it('handles complete session lifecycle', async () => {
    const bridge = new ClaudeACPBridge();
    
    // Test real JSON-RPC communication
    const init = await bridge.initialize({ 
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }
    });
    expect(init.protocolVersion).toBe(1);
    
    // Create session
    const session = await bridge.newSession({ cwd: '/test' });
    expect(session.sessionId).toMatch(UUID_REGEX);
    
    // Send prompt with file reference
    const response = await bridge.prompt({
      sessionId: session.sessionId,
      prompt: [
        { type: 'text', text: 'Analyze this file:' },
        { type: 'resource_link', uri: 'file://src/index.ts' }
      ]
    });
    
    // Verify streaming and completion
    expect(response.stopReason).toBe('end_turn');
  });
  
  it('handles file resolution fallbacks', async () => {
    // Test smart file search when exact path fails
  });
  
  it('manages permissions correctly', async () => {
    // Test permission caching and granular controls
  });
  
  it('recovers from errors gracefully', async () => {
    // Test error scenarios and recovery
  });
});
```

## Implementation Phases

### Phase 1: Core Protocol (Week 1-2)
**~800 lines**
- JSON-RPC connection management
- Message validation with Zod schemas
- Basic session lifecycle
- Error handling framework

**Success Criteria:**
- Can connect to Zed and negotiate protocol
- Handles basic text prompts
- Proper error propagation

### Phase 2: File Intelligence (Week 3)
**~500 lines**
- Smart file resolution with glob fallbacks
- Directory expansion
- Gitignore respect
- ACP filesystem integration

**Success Criteria:**
- Handles `@file` references intelligently
- Provides helpful errors for missing files
- Accesses unsaved buffers

### Phase 3: Full Features (Week 4)
**~600 lines**
- Granular permission system
- Tool execution with progress updates
- Conversation history
- Image support

**Success Criteria:**
- Production-ready UX
- All Claude Code tools work
- Smooth permission flow

### Phase 4: Polish (Week 5)
**~300 lines**
- Performance optimizations
- Comprehensive error messages
- Documentation
- Test coverage

**Success Criteria:**
- <100ms response time for prompts
- Clear error messages for all failure modes
- 80% test coverage on critical paths

## Key Differences from Original Specs

### What We Learned from Gemini
1. **Protocol complexity is real**: ~400 lines just for reliable JSON-RPC
2. **Schema validation is mandatory**: Prevents countless protocol errors
3. **File resolution needs intelligence**: Users expect smart behavior
4. **Permissions need granularity**: Different tools need different permission models
5. **State management matters**: Conversation context is critical

### What We're Keeping Simple
1. **No MCP permission bridge**: Direct ACP calls work fine
2. **No session persistence**: Can add later if needed
3. **No custom auth**: Use Claude SDK's built-in
4. **Single repository structure**: Not overly modularized

### Realistic Expectations
- **Total lines**: ~2,200 (vs 200 unrealistic, vs 3,000 overengineered)
- **Development time**: 4-5 weeks for production quality
- **Maintenance burden**: Moderate - mostly protocol updates

## Success Metrics
1. **Functionality**: All core Claude Code features work in Zed
2. **Performance**: <100ms prompt initiation, smooth streaming
3. **Reliability**: <0.1% protocol errors in production
4. **User Experience**: Clear errors, smart file handling, granular permissions

## References
- [Agent Client Protocol Specification](https://agentclientprotocol.com/protocol/overview)
- [Claude Code TypeScript SDK](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript)
- [Gemini CLI Implementation](https://github.com/google/gemini-cli) - Reference implementation
- [Zed External Agents](https://zed.dev/docs/ai/external-agents)