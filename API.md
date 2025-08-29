# API Documentation

This document provides comprehensive API reference for developers building extensions or integrating with the Claude Code ACP Agent.

## Public API Overview

The agent exposes several key classes and interfaces for programmatic use:

### ClaudeACPAgent

Main agent class that implements the ACP protocol and manages session lifecycle.

```typescript
class ClaudeACPAgent implements ACPClient {
  constructor(
    input?: Readable,     // stdin stream (default: process.stdin)
    output?: Writable,    // stdout stream (default: process.stdout)
    diskFileSystem?: FileSystemService  // custom filesystem (optional)
  )
  
  // Lifecycle methods
  start(): Promise<void>
  stop(): Promise<void>
  
  // Protocol methods (automatically handled via ACP)
  initialize(params: InitializeRequest): Promise<InitializeResponse>
  newSession(params: NewSessionRequest): Promise<NewSessionResponse>
  loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse>
  prompt(params: PromptRequest): Promise<PromptResponse>
  authenticate(params: AuthenticateRequest): Promise<AuthenticateResponse>
  cancel(params: CancelNotification): Promise<void>
  
  // Client interface implementation
  sessionUpdate(params: { sessionId: string; update: SessionUpdate }): Promise<void>
  requestPermission(params: RequestPermissionParams): Promise<PermissionResponse>
  readTextFile(params: ReadTextFileParams): Promise<{ content: string }>
  writeTextFile(params: WriteTextFileParams): Promise<void>
}
```

### SessionManager

Handles multiple concurrent sessions with automatic cleanup.

```typescript
class SessionManager {
  constructor(options?: SessionManagerOptions)
  
  // Session lifecycle
  createSession(
    sessionId: string,
    config: Config,
    fileSystemService: FileSystemService,
    claudeSDK: ClaudeSDK,
    acpClient: ACPClient
  ): Promise<Session>
  
  getSession(sessionId: string): Promise<Session | null>
  destroySession(sessionId: string): Promise<void>
  destroyAllSessions(): Promise<void>
  
  // Resource management
  dispose(): void
  
  // Session monitoring
  getActiveSessionCount(): number
  listActiveSessions(): string[]
}

interface SessionManagerOptions {
  maxSessions?: number;      // Default: 10
  sessionTimeoutMs?: number; // Default: 3600000 (1 hour)
}
```

### Session

Individual conversation session with Claude SDK integration.

```typescript
class Session {
  readonly id: string
  readonly config: Config
  readonly claudeSDK: ClaudeSDK
  
  constructor(
    id: string,
    config: Config,
    client: ACPClient,
    claudeSDK: ClaudeSDK
  )
  
  // Session control
  prompt(request: PromptRequest): Promise<PromptResponse>
  cancel(): void
  updateLastUsed(): void
  
  // Internal utilities
  getAbortController(): AbortController
  isExpired(): boolean
}
```

### FileResolver

Intelligent file resolution with glob fallback and gitignore support.

```typescript
class FileResolver {
  constructor(config: Config, fileSystem: FileSystemService)
  
  // Core resolution methods
  resolvePrompt(
    content: ContentBlock[],
    signal: AbortSignal
  ): Promise<ResolvedContent[]>
  
  resolvePath(filePath: string, signal: AbortSignal): Promise<string>
  
  // Search capabilities
  globSearch(pattern: string, signal: AbortSignal): Promise<string[]>
  
  // Utility methods
  safeReadFile(filePath: string): Promise<string>
  private buildGitignore(): Promise<(path: string) => boolean>
}
```

### PermissionManager

Security layer for tool execution and file access.

```typescript
class PermissionManager {
  constructor(client: ACPClient, sessionId: string)
  
  // Permission checking
  checkPermission(
    tool: ToolCall,
    client: ACPClient,
    sessionId: string
  ): Promise<PermissionDecision>
  
  // Permission policies
  isDefaultAllowed(tool: ToolCall): boolean
  requiresPermission(tool: ToolCall): boolean
}
```

## Configuration Options

### Config Interface

Core configuration object used throughout the system:

```typescript
interface Config {
  cwd: string;                    // Working directory for file operations
  enableSmartSearch: boolean;     // Enable glob fallback for file resolution
  respectGitignore: boolean;      // Filter files using gitignore rules
  debug: boolean;                 // Enable debug logging
  maxConcurrentSessions?: number; // Maximum concurrent sessions
  sessionTimeoutMs?: number;      // Session timeout in milliseconds
}
```

### AgentConfig Interface

Agent-specific configuration loaded from environment:

```typescript
interface AgentConfig {
  maxSessions: number;           // Maximum concurrent sessions (env: MAX_SESSIONS)
  sessionTimeoutMs: number;      // Session timeout (env: SESSION_TIMEOUT_MS)
  debug: boolean;                // Debug mode (env: DEBUG)
  claudeApiKey?: string;         // API key (env: CLAUDE_API_KEY)
  enableSmartSearch: boolean;    // Smart search (env: ENABLE_SMART_SEARCH)
  respectGitignore: boolean;     // Gitignore filtering (env: RESPECT_GITIGNORE)
}
```

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CLAUDE_API_KEY` | string | required | Anthropic API key for Claude access |
| `DEBUG` | boolean | false | Enable debug logging |
| `ACP_LOG_LEVEL` | enum | 'info' | Log level: error\|warn\|info\|debug |
| `ACP_TIMEOUT` | number | 1800000 | Session timeout in milliseconds |
| `MAX_SESSIONS` | number | 10 | Maximum concurrent sessions |
| `SESSION_TIMEOUT_MS` | number | 3600000 | Individual session timeout |
| `ENABLE_SMART_SEARCH` | boolean | true | Enable glob fallback for files |
| `RESPECT_GITIGNORE` | boolean | true | Filter files by gitignore rules |

## Protocol Integration

### ACP Client Interface

Interface for communicating with Zed Editor via ACP protocol:

```typescript
interface ACPClient {
  // Session communication
  sessionUpdate(params: {
    sessionId: string;
    update: SessionUpdate;
  }): Promise<void>;
  
  // Permission requests
  requestPermission(params: {
    sessionId: string;
    toolCall: ToolCallUpdate;
    options: PermissionOption[];
  }): Promise<{ outcome: { outcome: string; optionId?: string } }>;
  
  // File operations
  readTextFile(params: {
    sessionId: string;
    path: string;
    line?: number | null;
    limit?: number | null;
  }): Promise<{ content: string }>;
  
  writeTextFile(params: {
    sessionId: string;
    path: string;
    content: string;
  }): Promise<void>;
}
```

### Claude SDK Integration

Interface for Claude API communication:

```typescript
interface ClaudeSDK {
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
  }): AsyncGenerator<ClaudeMessage, void, unknown>;
}
```

## Extension Points

### Custom Tool Implementation

Implement the ToolCall interface to add new capabilities:

```typescript
interface ToolCall {
  id: string;                    // Unique tool execution ID
  name: string;                  // Human-readable tool name
  type: 'file_edit' | 'execute' | 'read' | 'search' | 'other';
  description: string;           // Tool description for permissions
  parameters: Record<string, unknown>; // Tool-specific parameters
}

// Example custom tool
class CustomTool implements ToolCall {
  id = randomUUID();
  name = 'Custom Operation';
  type = 'other';
  description = 'Performs custom business logic';
  parameters = { customParam: 'value' };
  
  async execute(): Promise<ToolResult> {
    // Custom implementation
    return {
      success: true,
      result: 'Operation completed'
    };
  }
}
```

### Custom File Systems

Implement FileSystemService for alternative storage backends:

```typescript
interface FileSystemService {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  stat(path: string): Promise<Stats>;
  exists(path: string): Promise<boolean>;
  readdir(path: string): Promise<string[]>;
}

// Example: Remote filesystem
class RemoteFileSystem implements FileSystemService {
  constructor(private apiEndpoint: string) {}
  
  async readFile(path: string): Promise<string> {
    const response = await fetch(`${this.apiEndpoint}/files${path}`);
    return await response.text();
  }
  
  // ... implement other methods
}
```

### Custom Permission Strategies

Extend permission handling for custom security policies:

```typescript
class CustomPermissionManager extends PermissionManager {
  async checkPermission(
    tool: ToolCall,
    client: ACPClient,
    sessionId: string
  ): Promise<PermissionDecision> {
    // Custom permission logic
    if (tool.type === 'execute' && tool.parameters.command?.includes('rm')) {
      // Always deny dangerous commands
      return {
        allowed: false,
        reason: 'Destructive commands not allowed'
      };
    }
    
    // Delegate to default logic for other cases
    return super.checkPermission(tool, client, sessionId);
  }
}
```

## Message Types and Schemas

### Content Blocks

Data structures for prompt content:

```typescript
interface TextContentBlock {
  type: 'text';
  text: string;
}

interface ResourceContentBlock {
  type: 'resource_link';
  uri: string;          // File URI (file://path/to/file)
  text?: string;        // Optional display text
}

type ContentBlock = TextContentBlock | ResourceContentBlock;
```

### Session Updates

Message types for streaming responses:

```typescript
type SessionUpdate = 
  | UserMessageChunk
  | AgentMessageChunk
  | ToolCallUpdate
  | ErrorUpdate;

interface UserMessageChunk {
  sessionUpdate: 'user_message_chunk';
  content: ContentBlock;
}

interface AgentMessageChunk {
  sessionUpdate: 'agent_message_chunk';
  content: ContentBlock;
}

interface ToolCallUpdate {
  sessionUpdate: 'tool_call';
  toolCallId: string;
  title: string;
  status: 'in_progress' | 'completed' | 'failed';
  kind: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other';
  description?: string;
  result?: string;
}
```

### Permission System

Permission-related data structures:

```typescript
interface PermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}

interface PermissionDecision {
  allowed: boolean;
  scope: 'once' | 'always' | 'never';
  cacheKey?: string;
}

type PermissionOutcome = 'selected' | 'cancelled';
```

## Error Handling

### Error Types

Structured error handling with ACP-compatible codes:

```typescript
interface ACPError {
  code: number;     // JSON-RPC error code
  message: string;  // Human-readable message
  data?: unknown;   // Additional error context
}

// Standard error codes
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
} as const;

// Custom error codes
const ACP_ERRORS = {
  SESSION_NOT_FOUND: -32005,
  NOT_INITIALIZED: -32006,
  LIMIT_EXCEEDED: -32004,
  AUTH_ERROR: -32000
} as const;
```

### Error Handler Utility

Centralized error processing:

```typescript
class ErrorHandler {
  static handle(error: unknown, context?: ErrorContext): ACPError {
    // Converts any error to structured ACPError
  }
  
  static isACPError(error: unknown): error is ACPError {
    // Type guard for ACP errors
  }
  
  static createFileNotFoundError(path: string): ACPError {
    // Factory for common error types
  }
}

interface ErrorContext {
  sessionId?: string;
  operation?: string;
  filePath?: string;
  additionalData?: unknown;
}
```

## Integration Examples

### Basic Agent Setup

```typescript
import { ClaudeACPAgent } from 'claude-code-acp';

// Create agent with default settings
const agent = new ClaudeACPAgent();

// Start the agent
try {
  await agent.start();
  console.log('Agent started successfully');
} catch (error) {
  console.error('Failed to start agent:', error);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  await agent.stop();
  process.exit(0);
});
```

### Custom File System Integration

```typescript
import { FileSystemService } from 'claude-code-acp';

class DatabaseFileSystem implements FileSystemService {
  constructor(private db: Database) {}
  
  async readFile(path: string): Promise<string> {
    const file = await this.db.files.findOne({ path });
    if (!file) throw new Error(`File not found: ${path}`);
    return file.content;
  }
  
  async writeFile(path: string, content: string): Promise<void> {
    await this.db.files.upsert({ path }, { content, updatedAt: new Date() });
  }
  
  async stat(path: string): Promise<Stats> {
    const file = await this.db.files.findOne({ path });
    return {
      isFile: () => !!file,
      isDirectory: () => false,
      size: file?.content.length || 0,
      mtime: file?.updatedAt || new Date()
    };
  }
  
  async exists(path: string): Promise<boolean> {
    return !!(await this.db.files.findOne({ path }));
  }
}

// Use custom filesystem
const customFS = new DatabaseFileSystem(database);
const agent = new ClaudeACPAgent(process.stdin, process.stdout, customFS);
```

### Custom Permission Handler

```typescript
import { PermissionManager, ToolCall, ACPClient, PermissionDecision } from 'claude-code-acp';

class StrictPermissionManager extends PermissionManager {
  private allowedCommands = ['ls', 'cat', 'grep', 'find'];
  
  async checkPermission(
    tool: ToolCall,
    client: ACPClient,
    sessionId: string
  ): Promise<PermissionDecision> {
    // Custom security policy
    if (tool.type === 'execute') {
      const command = tool.parameters.command as string;
      const baseCommand = command.split(' ')[0];
      
      if (!this.allowedCommands.includes(baseCommand)) {
        return {
          allowed: false,
          reason: `Command '${baseCommand}' not in allowlist`
        };
      }
    }
    
    // Delegate to default permission logic
    return super.checkPermission(tool, client, sessionId);
  }
}
```

### Advanced Session Configuration

```typescript
// Configure agent with custom settings
const agent = new ClaudeACPAgent();

// Environment variable configuration
process.env.MAX_SESSIONS = '5';
process.env.SESSION_TIMEOUT_MS = '1800000'; // 30 minutes
process.env.ENABLE_SMART_SEARCH = 'true';
process.env.RESPECT_GITIGNORE = 'true';
process.env.ACP_LOG_LEVEL = 'debug';

// Start with debug logging
process.env.DEBUG = 'true';
await agent.start();
```

## Protocol Message Reference

### Initialize Request/Response

```typescript
interface InitializeRequest {
  protocolVersion: number;  // Must be 1
}

interface InitializeResponse {
  protocolVersion: number;  // Always 1
  agentCapabilities: {
    loadSession: boolean;   // true - supports session loading
    promptCapabilities: {
      image: boolean;       // true - supports image content
      audio: boolean;       // false - no audio support
      embeddedContext: boolean; // true - supports file context
    };
  };
  authMethods?: Array<{   // Optional authentication methods
    id: string;
    name: string;
    description?: string;
  }>;
}
```

### Session Creation

```typescript
interface NewSessionRequest {
  cwd: string;  // Working directory for the session
}

interface NewSessionResponse {
  sessionId: string;  // UUID for the created session
}
```

### Prompt Request/Response

```typescript
interface PromptRequest {
  sessionId: string;
  prompt: ContentBlock[];  // Array of content blocks
}

interface PromptResponse {
  stopReason: 'end_turn' | 'cancelled' | 'error';
}
```

### File Operations

```typescript
interface ReadTextFileRequest {
  sessionId: string;
  path: string;       // Relative or absolute path
  line?: number;      // Optional line number to start from
  limit?: number;     // Optional line limit
}

interface ReadTextFileResponse {
  content: string;    // File contents
}

interface WriteTextFileRequest {
  sessionId: string;
  path: string;       // Target file path
  content: string;    // Content to write
}
```

## Testing API

### Test Utilities

Utilities for testing ACP integrations:

```typescript
// Mock ACP client for testing
class MockACPClient implements ACPClient {
  private sessionUpdates: SessionUpdate[] = [];
  
  async sessionUpdate(params: { sessionId: string; update: SessionUpdate }): Promise<void> {
    this.sessionUpdates.push(params.update);
  }
  
  getSessionUpdates(): SessionUpdate[] {
    return this.sessionUpdates;
  }
  
  async requestPermission(): Promise<{ outcome: { outcome: string } }> {
    return { outcome: { outcome: 'approved' } };
  }
  
  async readTextFile(): Promise<{ content: string }> {
    return { content: 'mock file content' };
  }
  
  async writeTextFile(): Promise<void> {
    // Mock implementation
  }
}

// Example test setup
describe('ClaudeACPAgent', () => {
  let agent: ClaudeACPAgent;
  let mockClient: MockACPClient;
  
  beforeEach(() => {
    mockClient = new MockACPClient();
    agent = new ClaudeACPAgent();
  });
  
  it('should handle initialize request', async () => {
    const response = await agent.initialize({ protocolVersion: 1 });
    expect(response.protocolVersion).toBe(1);
    expect(response.agentCapabilities.loadSession).toBe(true);
  });
});
```

### Mock File System

```typescript
class MockFileSystem implements FileSystemService {
  private files = new Map<string, string>();
  
  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (!content) throw new Error(`File not found: ${path}`);
    return content;
  }
  
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  
  async stat(path: string): Promise<Stats> {
    if (!await this.exists(path)) {
      throw new Error(`File not found: ${path}`);
    }
    
    return {
      isFile: () => true,
      isDirectory: () => false,
      size: this.files.get(path)?.length || 0,
      mtime: new Date()
    };
  }
  
  // Test utility methods
  addFile(path: string, content: string): void {
    this.files.set(path, content);
  }
  
  clear(): void {
    this.files.clear();
  }
}
```

## Performance Optimization

### Configuration Tuning

Optimize for different deployment scenarios:

```typescript
// High-performance configuration
const highPerformanceConfig = {
  MAX_SESSIONS: '20',
  SESSION_TIMEOUT_MS: '7200000',    // 2 hours
  ENABLE_SMART_SEARCH: 'true',
  RESPECT_GITIGNORE: 'false'        // Skip gitignore parsing
};

// Memory-constrained configuration
const constrainedConfig = {
  MAX_SESSIONS: '3',
  SESSION_TIMEOUT_MS: '900000',     // 15 minutes
  ENABLE_SMART_SEARCH: 'false',     // Disable expensive glob operations
  RESPECT_GITIGNORE: 'true'
};
```

### Memory Management

```typescript
// Monitor session memory usage
class SessionManager {
  getMemoryUsage(): {
    activeSessions: number;
    totalMemoryMB: number;
    averageSessionMB: number;
  } {
    const used = process.memoryUsage();
    return {
      activeSessions: this.sessions.size,
      totalMemoryMB: Math.round(used.heapUsed / 1024 / 1024),
      averageSessionMB: Math.round(used.heapUsed / 1024 / 1024 / this.sessions.size)
    };
  }
}
```

## Security Considerations

### API Key Management

Never hardcode API keys in source code:

```typescript
// Good: Environment variable
const apiKey = process.env.CLAUDE_API_KEY;
if (!apiKey) {
  throw new Error('CLAUDE_API_KEY environment variable required');
}

// Bad: Hardcoded key
const apiKey = 'sk-ant-api03-...';
```

### File System Security

Implement path traversal protection:

```typescript
// Path validation example
function validatePath(requestedPath: string, cwd: string): string {
  const resolved = path.resolve(cwd, requestedPath);
  
  // Ensure path is within project directory
  if (!resolved.startsWith(path.resolve(cwd))) {
    throw new Error('Path traversal attempt detected');
  }
  
  return resolved;
}
```

### Permission Validation

Always validate tool parameters:

```typescript
function validateToolParameters(tool: ToolCall): void {
  if (tool.type === 'execute') {
    const command = tool.parameters.command as string;
    
    // Block dangerous command patterns
    const dangerousPatterns = [
      /rm\s+-rf/,
      /sudo\s+/,
      /\|\s*sh/,
      /eval\s*\(/
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        throw new Error(`Dangerous command pattern detected: ${pattern}`);
      }
    }
  }
}
```

## Troubleshooting API Issues

### Common Integration Problems

#### TypeScript Compilation Errors
```bash
# Check for type mismatches
npm run typecheck

# Common issues:
# - Missing interface implementations
# - Incorrect generic types
# - Async/await usage errors
```

#### Runtime Errors
```typescript
// Enable debug mode for detailed logs
process.env.DEBUG = 'true';
process.env.ACP_LOG_LEVEL = 'debug';

// Common runtime issues:
// - Missing environment variables
// - File permission errors
// - Network connectivity problems
// - Invalid ACP message formats
```

#### Performance Issues
```typescript
// Monitor session performance
class PerformanceMonitor {
  private metrics = new Map<string, number>();
  
  startTimer(operation: string): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.metrics.set(operation, duration);
      console.log(`${operation}: ${duration}ms`);
    };
  }
}

// Usage
const monitor = new PerformanceMonitor();
const endTimer = monitor.startTimer('file-resolution');
const result = await fileResolver.resolvePath(filePath, signal);
endTimer();
```

## Migration Guide

### From v0.x to v1.x

Breaking changes and migration steps:

```typescript
// Old API (v0.x)
const agent = new ACPAgent({ debug: true });
await agent.initialize();

// New API (v1.x)
process.env.DEBUG = 'true';
const agent = new ClaudeACPAgent();
// Initialization happens automatically on first ACP message
```

### Environment Variable Changes

| Old Variable | New Variable | Notes |
|-------------|--------------|-------|
| `CLAUDE_DEBUG` | `DEBUG` | Simplified debug flag |
| `ACP_MAX_SESSIONS` | `MAX_SESSIONS` | Shorter name |
| `IGNORE_GITIGNORE` | `RESPECT_GITIGNORE` | Inverted logic |

## Support and Resources

### Documentation
- [README.md](./README.md) - User guide and basic setup
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design and components
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Development setup and guidelines

### External Resources
- [Agent Client Protocol Specification](https://github.com/zed-industries/agent-client-protocol)
- [Claude SDK Documentation](https://github.com/anthropic-ai/claude-code)
- [Zed Editor Extensions Guide](https://zed.dev/docs/extensions)

### Community
- [GitHub Issues](https://github.com/carlrannaberg/cc-acp/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/carlrannaberg/cc-acp/discussions) - General questions and ideas

For immediate support, enable debug mode and include logs in your issue report:

```bash
export ACP_LOG_LEVEL=debug
export DEBUG=true
claudeCodeACP 2>&1 | tee debug.log
```