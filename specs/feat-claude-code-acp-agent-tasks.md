# Task Breakdown: Claude Code ACP Agent for Zed Editor
Generated: 2025-08-29
Source: specs/feat-claude-code-acp-agent.md

## Overview
Building a production-quality bridge that enables Claude Code to run as an external agent within Zed Editor via the Agent Client Protocol (ACP). Total estimated lines: ~2,200 lines of production code across 4 phases.

## Phase 1: Core Protocol (Week 1-2, ~800 lines)

### Task 1.1: Initialize TypeScript Project Structure
**Description**: Set up TypeScript project with proper configuration and dependencies
**Size**: Small
**Priority**: High
**Dependencies**: None
**Can run parallel with**: None

**Technical Requirements**:
- Initialize npm project with TypeScript 5.0+
- Install core dependencies:
  - `@zed-industries/agent-client-protocol@^0.1.2`
  - `@anthropic-ai/claude-code@^1.0.96`
  - `zod@^3.22.0`
  - TypeScript dev dependencies
- Configure TypeScript for Node.js 18+ target
- Set up build scripts with esbuild or similar

**Implementation Steps**:
1. Run `npm init -y` and configure package.json
2. Install dependencies: `npm install @zed-industries/agent-client-protocol@^0.1.2 @anthropic-ai/claude-code@^1.0.96 zod@^3.22.0`
3. Install dev dependencies: `npm install -D typescript@^5.0.0 @types/node@^18.0.0 esbuild`
4. Create tsconfig.json with Node.js 18 target
5. Set up npm scripts for build, dev, and test

**Acceptance Criteria**:
- [ ] Project builds without errors
- [ ] TypeScript configuration targets Node.js 18+
- [ ] All required dependencies installed
- [ ] Build script produces executable output

### Task 1.2: Create Project Directory Structure
**Description**: Set up the module structure as defined in the specification
**Size**: Small
**Priority**: High
**Dependencies**: Task 1.1
**Can run parallel with**: Task 1.3

**Technical Requirements**:
Create the following directory structure:
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

**Implementation Steps**:
1. Create src directory and subdirectories
2. Create placeholder files with module exports
3. Add index.ts entry point with basic structure

**Acceptance Criteria**:
- [ ] All directories created as specified
- [ ] Placeholder files with proper module exports
- [ ] TypeScript imports resolve correctly

### Task 1.3: Implement JSON-RPC Connection Handler
**Description**: Build robust JSON-RPC implementation with proper message handling
**Size**: Large
**Priority**: High
**Dependencies**: Task 1.2
**Can run parallel with**: Task 1.4

**Technical Requirements**:
Implement src/protocol/connection.ts with the following code from the specification:

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

**Additional Implementation Requirements**:
- Implement tryCallHandler method with proper error handling
- Implement handleResponse method for resolving pending requests
- Add proper TypeScript types for PendingResponse, AnyMessage, MethodHandler
- Include request/response correlation with IDs
- Handle JSON-RPC 2.0 error codes properly

**Acceptance Criteria**:
- [ ] Handles JSON-RPC requests, responses, and notifications
- [ ] Queued writes prevent message interleaving
- [ ] Proper error handling for malformed messages
- [ ] Request/response correlation works correctly
- [ ] Tests for concurrent message handling

### Task 1.4: Create Zod Schema Definitions
**Description**: Implement comprehensive Zod schemas for all ACP message types
**Size**: Large
**Priority**: High
**Dependencies**: Task 1.2
**Can run parallel with**: Task 1.3

**Technical Requirements**:
Implement src/protocol/schemas.ts with the following schemas from the specification:

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

**Additional Schemas to Implement**:
- annotationsSchema for message annotations
- toolCallContentSchema for tool call content
- initializeRequestSchema and initializeResponseSchema
- newSessionRequestSchema and newSessionResponseSchema
- cancelNotificationSchema
- requestPermissionRequestSchema and requestPermissionResponseSchema
- All other ACP protocol message schemas

**Acceptance Criteria**:
- [ ] All ACP message types have Zod schemas
- [ ] Schemas validate correctly against sample messages
- [ ] TypeScript types exported from schemas
- [ ] Discriminated unions work for variant types
- [ ] Tests validate schema correctness

### Task 1.5: Implement Error Handling Framework
**Description**: Create comprehensive error handling with proper recovery strategies
**Size**: Medium
**Priority**: High
**Dependencies**: Task 1.2
**Can run parallel with**: Task 1.6

**Technical Requirements**:
Implement src/utils/errors.ts with the following code from the specification:

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

**Additional Requirements**:
- Define ACPError interface
- Define ClaudeSDKError class
- Add error logging mechanism
- Include error recovery strategies
- JSON-RPC error code constants

**Acceptance Criteria**:
- [ ] Handles all error types appropriately
- [ ] Returns proper JSON-RPC error codes
- [ ] Includes helpful error messages
- [ ] Stack traces only in debug mode
- [ ] Tests for various error scenarios

### Task 1.6: Create Base TypeScript Types
**Description**: Define core TypeScript types and interfaces
**Size**: Medium
**Priority**: High
**Dependencies**: Task 1.2
**Can run parallel with**: Task 1.5

**Technical Requirements**:
Implement src/utils/types.ts with core type definitions:

```typescript
// Core configuration types
export interface Config {
  cwd: string;
  enableSmartSearch: boolean;
  respectGitignore: boolean;
  debug: boolean;
}

// File system service interface
export interface FileSystemService {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  stat(path: string): Promise<Stats>;
  exists(path: string): Promise<boolean>;
}

// Session types
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Permission types
export interface PermissionDecision {
  allowed: boolean;
  scope: 'once' | 'always' | 'never';
  tool?: string;
}

// Tool call types
export interface ToolCall {
  id: string;
  name: string;
  type: string;
  description: string;
  command?: string;
  execute(): Promise<any>;
}
```

**Additional Types to Define**:
- ACPClient interface
- ClaudeSDK interface
- ResolvedContent type
- Stats interface for file system
- All method handler types

**Acceptance Criteria**:
- [ ] All core types defined
- [ ] Interfaces properly documented
- [ ] Types exported correctly
- [ ] No circular dependencies
- [ ] Compatible with Zod schemas

## Phase 2: File Intelligence (Week 3, ~500 lines)

### Task 2.1: Implement Smart File Resolution
**Description**: Build intelligent file handling with fallback strategies
**Size**: Large
**Priority**: High
**Dependencies**: Task 1.6
**Can run parallel with**: Task 2.2

**Technical Requirements**:
Implement src/files/resolver.ts with the following code from the specification:

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

**Additional Methods to Implement**:
- selectBestMatch(path: string, matches: string[]): string
- suggestSimilar(path: string): Promise<string>
- getGitignorePatterns(): Promise<string[]>
- isWithinRoot(path: string, root: string): boolean

**Acceptance Criteria**:
- [ ] Direct file access works correctly
- [ ] Falls back to glob search when file not found
- [ ] Respects gitignore patterns
- [ ] Directory expansion to glob patterns
- [ ] Provides helpful error messages with suggestions
- [ ] Tests for various file resolution scenarios

### Task 2.2: Create ACP Filesystem Proxy
**Description**: Implement filesystem proxy for unsaved buffer access
**Size**: Medium
**Priority**: High
**Dependencies**: Task 1.6
**Can run parallel with**: Task 2.1

**Technical Requirements**:
Implement src/files/filesystem.ts:

```typescript
export class ACPFileSystem implements FileSystemService {
  constructor(
    private client: ACPClient,
    private sessionId: string,
    private fallback: FileSystemService
  ) {}

  async readFile(path: string): Promise<string> {
    try {
      // Try ACP filesystem first for unsaved buffers
      const response = await this.client.readTextFile({
        sessionId: this.sessionId,
        path: path
      });
      return response.content;
    } catch (error) {
      // Fall back to disk access
      return this.fallback.readFile(path);
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    // Always use ACP for writes to maintain consistency
    await this.client.writeTextFile({
      sessionId: this.sessionId,
      path: path,
      content: content
    });
  }

  async stat(path: string): Promise<Stats> {
    // Use fallback for stat operations
    return this.fallback.stat(path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }
}
```

**Additional Requirements**:
- Handle ACP filesystem capabilities check
- Implement proper error handling for ACP calls
- Support both absolute and relative paths
- Cache frequently accessed files if needed

**Acceptance Criteria**:
- [ ] Reads from unsaved buffers via ACP
- [ ] Falls back to disk when ACP unavailable
- [ ] Write operations go through ACP
- [ ] Stat operations work correctly
- [ ] Tests for both ACP and fallback paths

## Phase 3: Bridge Implementation (Week 4, ~850 lines)

### Task 3.1: Implement Main ACP Agent
**Description**: Build the main ACP agent that handles protocol lifecycle
**Size**: Large
**Priority**: High
**Dependencies**: Tasks 1.3, 1.4, 1.5
**Can run parallel with**: None

**Technical Requirements**:
Implement src/bridge/agent.ts:

```typescript
import { AgentSideConnection } from '@zed-industries/agent-client-protocol';

export class ClaudeACPAgent {
  private connection: AgentSideConnection;
  private sessions = new Map<string, Session>();
  
  constructor() {
    this.connection = new AgentSideConnection(
      (client) => this,
      process.stdin,
      process.stdout
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Implement all ACP protocol methods
  }

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: 1,
      agentCapabilities: {
        promptCapabilities: {
          image: true,
          audio: false,
          embeddedContext: true
        }
      }
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = crypto.randomUUID();
    const config: Config = {
      cwd: params.cwd,
      enableSmartSearch: true,
      respectGitignore: true,
      debug: process.env.DEBUG === 'true'
    };
    
    const fileSystem = new ACPFileSystem(
      this.connection,
      sessionId,
      new DiskFileSystem()
    );
    
    const session = new Session(
      sessionId,
      config,
      this.connection,
      new ClaudeSDK()
    );
    
    this.sessions.set(sessionId, session);
    return { sessionId };
  }
}
```

**Additional Methods to Implement**:
- loadSession (optional)
- authenticate
- prompt (delegates to session)
- cancel (delegates to session)

**Acceptance Criteria**:
- [ ] Initializes ACP connection correctly
- [ ] Creates and manages sessions
- [ ] Handles all ACP protocol methods
- [ ] Proper error handling for all operations
- [ ] Tests for protocol lifecycle

### Task 3.2: Implement Session Management
**Description**: Build stateful session management with conversation history
**Size**: Large
**Priority**: High
**Dependencies**: Task 3.1
**Can run parallel with**: Task 3.3

**Technical Requirements**:
Implement src/bridge/session.ts with the following code from the specification:

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

**Additional Methods to Implement**:
- buildPromptWithContext(resolved: ResolvedContent[]): string
- processChunk(chunk: any): Promise<void>
- mapToolKind(toolName: string): string
- buildToolContent(tool: ToolCall): any[]
- formatToolResult(result: any): any[]
- checkPermission(tool: ToolCall): Promise<PermissionDecision>

**Acceptance Criteria**:
- [ ] Maintains conversation history
- [ ] Handles prompt cancellation correctly
- [ ] Streams responses with backpressure handling
- [ ] Tool execution with permission checks
- [ ] Proper error handling and recovery
- [ ] Tests for various prompt scenarios

### Task 3.3: Implement Permission System
**Description**: Build granular permission handling with caching
**Size**: Medium
**Priority**: High
**Dependencies**: Task 3.1
**Can run parallel with**: Task 3.2

**Technical Requirements**:
Implement src/bridge/permissions.ts with the following code from the specification:

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

**Additional Methods to Implement**:
- getCacheKey(tool: ToolCall): string
- isCacheValid(cached: PermissionDecision, tool: ToolCall): boolean
- mapToolKind(tool: ToolCall): string
- buildToolContent(tool: ToolCall): any
- processResponse(response: any): PermissionDecision

**Acceptance Criteria**:
- [ ] Permission caching works correctly
- [ ] Granular permission options based on tool type
- [ ] Cache invalidation for changed contexts
- [ ] Proper permission dialog content
- [ ] Tests for various permission scenarios

## Phase 4: Polish and Integration (Week 5, ~300 lines)

### Task 4.1: Create Entry Point and CLI
**Description**: Build the main entry point and CLI handling
**Size**: Small
**Priority**: High
**Dependencies**: Task 3.1
**Can run parallel with**: Task 4.2

**Technical Requirements**:
Implement src/index.ts:

```typescript
#!/usr/bin/env node

import { ClaudeACPAgent } from './bridge/agent';

async function main() {
  try {
    const agent = new ClaudeACPAgent();
    await agent.start();
  } catch (error) {
    console.error('Failed to start Claude ACP Agent:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
```

**Additional Requirements**:
- Add command-line argument parsing if needed
- Support environment variable configuration
- Add version information
- Include help text

**Acceptance Criteria**:
- [ ] Executable entry point works
- [ ] Graceful shutdown handling
- [ ] Proper error reporting
- [ ] Environment variable support
- [ ] Tests for CLI behavior

### Task 4.2: Add Performance Optimizations
**Description**: Implement performance optimizations for production use
**Size**: Medium
**Priority**: Medium
**Dependencies**: Tasks 3.1, 3.2
**Can run parallel with**: Task 4.1

**Technical Requirements**:
- Implement message batching for high-frequency updates
- Add connection pooling for Claude SDK
- Optimize file resolution with caching
- Implement backpressure handling for streams
- Add memory management for long sessions

**Implementation Areas**:
1. Message batching in Connection class
2. File resolution cache in FileResolver
3. Session cleanup after timeout
4. Stream buffering optimization
5. Memory profiling and limits

**Acceptance Criteria**:
- [ ] Response time <100ms for prompts
- [ ] Memory usage stays bounded
- [ ] Stream backpressure works correctly
- [ ] File resolution cache improves performance
- [ ] Performance benchmarks pass

### Task 4.3: Create Integration Tests
**Description**: Build comprehensive integration tests for the complete system
**Size**: Medium
**Priority**: High
**Dependencies**: Tasks 3.1, 3.2, 3.3
**Can run parallel with**: Task 4.4

**Technical Requirements**:
Implement tests/integration/protocol.test.ts with code from specification:

```typescript
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

**Additional Test Scenarios**:
- Concurrent session handling
- Large file handling
- Network error recovery
- Rate limit handling
- Memory leak detection

**Acceptance Criteria**:
- [ ] All integration tests pass
- [ ] Tests cover critical paths
- [ ] Error scenarios tested
- [ ] Performance benchmarks included
- [ ] 80% code coverage on critical paths

### Task 4.4: Write Documentation
**Description**: Create comprehensive documentation for users and developers
**Size**: Medium
**Priority**: Medium
**Dependencies**: All implementation tasks
**Can run parallel with**: Task 4.3

**Technical Requirements**:
Create the following documentation:

1. **README.md**: 
   - Installation instructions
   - Zed configuration guide
   - Basic usage examples
   - Troubleshooting section
   - Environment variables

2. **ARCHITECTURE.md**:
   - System architecture overview
   - Component descriptions
   - Data flow diagrams
   - Protocol specifications

3. **CONTRIBUTING.md**:
   - Development setup
   - Testing guidelines
   - Code style guide
   - Pull request process

4. **API.md**:
   - Public API documentation
   - Extension points
   - Configuration options

**Acceptance Criteria**:
- [ ] README covers installation and basic usage
- [ ] Architecture document explains system design
- [ ] API documentation is complete
- [ ] Examples work correctly
- [ ] Documentation is clear and accurate

### Task 4.5: Package and Publish
**Description**: Prepare the package for distribution
**Size**: Small
**Priority**: Low
**Dependencies**: All tasks
**Can run parallel with**: None

**Technical Requirements**:
- Configure package.json for npm publishing
- Create .npmignore file
- Set up GitHub Actions for CI/CD
- Create release scripts
- Add changelog

**Implementation Steps**:
1. Update package.json with proper metadata
2. Create build scripts for distribution
3. Set up automated testing in CI
4. Create release workflow
5. Test installation from npm

**Acceptance Criteria**:
- [ ] Package installs correctly from npm
- [ ] Binary executable works after installation
- [ ] CI/CD pipeline runs tests
- [ ] Release process documented
- [ ] Package size is reasonable

## Summary

**Total Tasks**: 20
- Phase 1 (Core Protocol): 6 tasks
- Phase 2 (File Intelligence): 2 tasks  
- Phase 3 (Bridge Implementation): 3 tasks
- Phase 4 (Polish): 5 tasks

**Parallel Execution Opportunities**:
- Phase 1: Tasks 1.3 and 1.4 can run in parallel
- Phase 1: Tasks 1.5 and 1.6 can run in parallel
- Phase 2: Tasks 2.1 and 2.2 can run in parallel
- Phase 3: Tasks 3.2 and 3.3 can run in parallel after 3.1
- Phase 4: Tasks 4.1 and 4.2 can run in parallel
- Phase 4: Tasks 4.3 and 4.4 can run in parallel

**Critical Path**:
1.1 → 1.2 → 1.3/1.4 → 3.1 → 3.2 → 4.3 → 4.5

**Risk Areas**:
- JSON-RPC protocol complexity (Task 1.3)
- Claude SDK integration (Task 3.2)
- Permission system edge cases (Task 3.3)
- Performance requirements (Task 4.2)