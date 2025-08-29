# Claude Code ACP Agent for Zed Editor

## Status
Draft

## Authors
Claude Code Assistant  
Date: 2025-08-28

## Overview
Build an Agent Client Protocol (ACP) wrapper that enables Claude Code to run as an external agent within Zed Editor. This implementation bridges Zed's ACP JSON-RPC communication with Claude Code's TypeScript SDK, providing seamless integration while maintaining proper permission controls and real-time streaming capabilities.

## Background/Problem Statement
Zed Editor supports external AI agents through the Agent Client Protocol (ACP), allowing users to integrate third-party AI services into their development workflow. Claude Code provides powerful AI assistance for software development tasks but currently lacks native Zed integration. 

The challenge is creating a bridge that:
- Translates ACP JSON-RPC messages to Claude Code SDK calls
- Streams real-time responses and tool execution updates
- Maintains Zed's permission model for file operations
- Provides access to unsaved buffer content
- Handles session management and cancellation properly

This integration would enable Zed users to leverage Claude Code's advanced capabilities directly within their editor environment.

## Goals
- Implement a fully functional ACP agent wrapper for Claude Code
- Support real-time streaming of Claude's responses and tool execution
- Bridge permission systems between Zed and Claude Code
- Enable access to unsaved buffer content through ACP filesystem proxy
- Support session management including resume/continue functionality
- Provide proper error handling and graceful cancellation
- Maintain compatibility with Claude Code's full tool suite
- Support MCP server integration through the bridge

## Non-Goals
- Modifying Zed Editor's core ACP implementation
- Creating a new AI model or replacing Claude Code's functionality
- Supporting audio input/output capabilities
- Implementing Zed-specific features like SSH project support
- Providing backward compatibility with older ACP versions
- Creating a standalone Claude Code alternative

## Technical Dependencies

### External Libraries
- **@zed-industries/agent-client-protocol**: `^0.1.2`
  - Official ACP TypeScript library
  - Provides `AgentSideConnection` and protocol schemas
  - Includes Zod for runtime validation
  
- **@anthropic-ai/claude-code**: `^1.0.96`
  - Official Claude Code TypeScript SDK  
  - Provides headless API with streaming support
  - Requires Node.js 18+
  
- **@modelcontextprotocol/sdk**: `^1.17.4`
  - MCP server/client implementation
  - Used for permission bridging
  - MIT licensed, actively maintained

### Runtime Requirements
- Node.js 18+ (required by Claude Code SDK)
- TypeScript 5.0+ for development
- Zod for runtime schema validation (included with ACP library)

### Documentation References
- [Agent Client Protocol Specification](https://agentclientprotocol.com/protocol/overview)
- [Claude Code TypeScript SDK](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript)
- [Model Context Protocol](https://modelcontextprotocol.io/docs)

## Detailed Design

### Architecture Overview

```
┌─────────────────┐    ACP/JSON-RPC     ┌─────────────────────┐
│   Zed Editor    │◄──────stdio──────────►│  ACP Agent Wrapper  │
│                 │                      │                     │
│ - UI Controls   │                      │ ┌─────────────────┐ │
│ - File Buffers  │                      │ │ ACP Server      │ │
│ - Permissions   │                      │ │ - Session Mgmt  │ │
└─────────────────┘                      │ │ - Protocol      │ │
                                         │ └─────────────────┘ │
                                         │                     │
                                         │ ┌─────────────────┐ │
                                         │ │ Permission      │ │
                                         │ │ Bridge (MCP)    │ │
                                         │ └─────────────────┘ │
                                         │                     │
                                         │ ┌─────────────────┐ │
                                         │ │ Claude Code SDK │ │
                                         │ │ Driver          │ │
                                         │ └─────────────────┘ │
                                         └─────────────────────┘
                                                    │
                                                    ▼
                                         ┌─────────────────────┐
                                         │   Claude Code CLI   │
                                         │ + Anthropic API     │
                                         └─────────────────────┘
```

### Core Components

#### 1. ACP Server Implementation
**File: `src/acp-server.ts`**

Handles the ACP protocol lifecycle:
- `initialize`: Negotiate capabilities and protocol version
- `session/new`: Create new Claude Code sessions
- `session/load`: Resume existing sessions (optional)
- `session/prompt`: Process user prompts and stream responses
- `session/cancel`: Handle cancellation via AbortController
- File system proxy methods for unsaved buffer access

```typescript
export class ClaudeCodeACPAgent {
  private connection: AgentSideConnection;
  private sessions: Map<string, ClaudeSession> = new Map();
  private mcpServer: PermissionBridge;

  async initialize(capabilities: ClientCapabilities): Promise<AgentCapabilities> {
    return {
      protocolVersion: "0.1.0",
      promptCapabilities: {
        image: true,
        audio: false
      },
      loadSession: true
    };
  }

  async createSession(params: NewSessionParams): Promise<{ sessionId: string }> {
    const sessionId = generateUUID();
    const session = new ClaudeSession({
      cwd: params.cwd,
      mcpServers: this.convertMcpServers(params.mcpServers),
      permissionBridge: this.mcpServer
    });
    
    this.sessions.set(sessionId, session);
    return { sessionId };
  }
}
```

#### 2. Claude Code Session Manager
**File: `src/claude-session.ts`**

Manages individual Claude Code SDK sessions:
- Wraps the Claude Code SDK's `query()` method
- Handles streaming message conversion from SDK to ACP format
- Manages AbortController for cancellation
- Integrates with permission bridge for tool usage approval

```typescript
export class ClaudeSession {
  private abortController?: AbortController;
  private currentQuery?: AsyncIterableIterator<any>;

  async prompt(content: ContentBlock[]): Promise<void> {
    this.abortController = new AbortController();
    
    const input = this.convertACPToSDKInput(content);
    
    this.currentQuery = query({
      prompt: input,
      options: {
        cwd: this.cwd,
        mcpServers: this.mcpServers,
        permissionMode: "default",
        permissionPromptTool: "approval_prompt",
        permissionPromptToolName: "zed_permission_bridge",
        maxTurns: 10,
        allowedTools: ["Bash", "Read", "Edit", "Write", "Grep", "Glob"],
        abortController: this.abortController
      }
    });

    await this.streamResponses();
  }

  private async streamResponses(): Promise<void> {
    for await (const message of this.currentQuery!) {
      const acpUpdate = this.convertSDKToACPUpdate(message);
      await this.connection.sendSessionUpdate(acpUpdate);
    }
  }
}
```

#### 3. Permission Bridge
**File: `src/permission-bridge.ts`**

Implements an MCP server that bridges permission requests:
- Exposes `approval_prompt` tool to Claude Code SDK
- Translates tool permission requests to ACP `session/request_permission`
- Handles user approval/denial and passes results back to Claude

```typescript
export class PermissionBridge {
  private mcpServer: McpServer;
  private acpConnection: AgentSideConnection;

  constructor(acpConnection: AgentSideConnection) {
    this.acpConnection = acpConnection;
    this.mcpServer = new McpServer({
      name: "zed_permission_bridge",
      version: "1.0.0"
    });

    this.setupTools();
  }

  private setupTools(): void {
    this.mcpServer.tool("approval_prompt", {
      description: "Request user permission for Claude Code operations",
      inputSchema: {
        type: "object",
        properties: {
          tool: { type: "string" },
          params: { type: "object" },
          riskLevel: { type: "string", enum: ["low", "medium", "high"] }
        }
      }
    }, async (args) => {
      const permission = await this.acpConnection.requestPermission({
        title: `Allow ${args.tool}?`,
        body: `Claude Code wants to run ${args.tool}`,
        options: ["allow_once", "deny_once", "allow_all", "deny_all"]
      });

      return {
        approved: permission.choice === "allow_once" || permission.choice === "allow_all",
        updatedInput: permission.updatedInput
      };
    });
  }
}
```

#### 4. Message Conversion Layer  
**File: `src/message-converter.ts`**

Handles bidirectional conversion between ACP and Claude Code SDK message formats:
- ACP ContentBlocks ↔ SDK input formats
- SDK streaming messages → ACP session updates
- Tool execution progress → ACP tool call updates
- File diff generation for edit operations

### File System Integration Strategy

**Option A: Lightweight Proxy (Recommended for MVP)**
- Allow Claude Code built-in tools to operate on disk
- Intercept write operations before execution
- Generate diffs and request permission via ACP
- Apply changes through ACP filesystem methods after approval

**Option B: Full FS Proxy**
- Disable Claude Code built-in file tools
- Implement MCP file tools that call ACP filesystem methods
- Provides access to unsaved buffer content
- More complex but better user experience

### API Changes
No changes to existing APIs. This is a new standalone component that communicates with external systems via established protocols.

### Data Model Changes
No persistent data storage required. All state is session-based and ephemeral:
- Session mappings (sessionId → ClaudeSession)
- Active AbortControllers for cancellation
- Permission states (temporary)

## User Experience

### Setup Experience
1. **Install the ACP Agent**: Users install the npm package globally
   ```bash
   npm install -g claude-code-acp-agent
   ```

2. **Configure Zed**: Add agent to Zed settings
   ```json
   {
     "agent_servers": {
       "Claude Code": {
         "command": "claude-code-acp-agent",
         "env": {
           "ANTHROPIC_API_KEY": "sk-..."
         }
       }
     }
   }
   ```

### Interaction Flow
1. **Agent Selection**: User selects "Claude Code" from Zed's agent dropdown
2. **Prompt Input**: User types prompts in Zed's AI panel with support for:
   - Text instructions
   - Image attachments (screenshots, diagrams)
   - Context from selected code blocks
3. **Real-time Streaming**: Claude's responses stream in real-time showing:
   - Text responses with syntax highlighting
   - Tool execution progress with expandable details
   - File diffs before changes are applied
4. **Permission Requests**: When Claude wants to execute potentially risky operations:
   - Clear permission dialog in Zed
   - Tool name and parameters displayed
   - Options: Allow Once, Deny Once, Allow All, Deny All
5. **File Changes**: After approval:
   - Changes applied to files (including unsaved buffers)
   - Visual diff indicators in editor
   - Undo/redo support through Zed's history

### Error Handling UX
- Network errors: Clear error messages with retry options
- Permission denials: Explanation of what was blocked and why
- Cancellation: Graceful termination with partial results preserved
- Tool failures: Detailed error context with suggested fixes

## Testing Strategy

### Unit Tests
**Framework**: Jest with TypeScript support

#### Core Component Tests
```typescript
// src/__tests__/acp-server.test.ts
describe('ClaudeCodeACPAgent', () => {
  describe('initialize', () => {
    it('should negotiate correct protocol version', async () => {
      // Test protocol negotiation
    });
    
    it('should advertise correct capabilities', async () => {
      // Test capability advertisement
    });
  });

  describe('session management', () => {
    it('should create unique session IDs', async () => {
      // Test session creation uniqueness
    });
    
    it('should handle concurrent sessions', async () => {
      // Test multiple active sessions
    });
  });
});

// src/__tests__/message-converter.test.ts  
describe('MessageConverter', () => {
  describe('ACP to SDK conversion', () => {
    it('should convert text content blocks correctly', () => {
      // Test basic text conversion
    });
    
    it('should handle image content blocks', () => {
      // Test image streaming format
    });
    
    it('should preserve context information', () => {
      // Test resource links and context
    });
  });

  describe('SDK to ACP conversion', () => {
    it('should stream assistant messages correctly', () => {
      // Test response streaming
    });
    
    it('should convert tool calls with progress', () => {
      // Test tool execution updates
    });
    
    it('should handle error scenarios', () => {
      // Test error propagation
    });
  });
});
```

#### Permission Bridge Tests
```typescript  
// src/__tests__/permission-bridge.test.ts
describe('PermissionBridge', () => {
  it('should proxy permission requests to ACP', async () => {
    // Test permission request flow
  });
  
  it('should handle user approval responses', async () => {
    // Test approval handling
  });
  
  it('should handle user denial responses', async () => {
    // Test denial handling
  });
  
  it('should support input modification in permissions', async () => {
    // Test updated input scenarios
  });
});
```

### Integration Tests
**Framework**: Jest with real ACP connection testing

#### End-to-End Protocol Tests
```typescript
// src/__tests__/integration/acp-protocol.test.ts
describe('ACP Protocol Integration', () => {
  let agent: ClaudeCodeACPAgent;
  let mockConnection: AgentSideConnection;

  beforeEach(() => {
    // Setup test ACP connection
  });

  it('should handle complete session lifecycle', async () => {
    // Test: initialize → create session → prompt → response → cleanup
  });
  
  it('should handle cancellation gracefully', async () => {
    // Test: start session → cancel → verify cleanup
  });
  
  it('should process file operations with permissions', async () => {
    // Test: prompt requiring file write → permission request → approval → execution
  });
});
```

#### Claude Code SDK Integration Tests  
```typescript
// src/__tests__/integration/claude-sdk.test.ts
describe('Claude Code SDK Integration', () => {
  it('should stream responses correctly', async () => {
    // Test actual SDK streaming with mocked Anthropic API
  });
  
  it('should handle tool execution', async () => {
    // Test tool calls with mocked filesystem
  });
  
  it('should respect permission modes', async () => {
    // Test permission mode enforcement
  });
});
```

### Mocking Strategies

#### External Service Mocks
```typescript
// src/__tests__/__mocks__/anthropic-api.ts
export const mockAnthropicAPI = {
  messages: {
    create: jest.fn().mockImplementation(() => ({
      // Mock streaming response
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'content_block_start', content_block: { type: 'text', text: '' } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
        yield { type: 'content_block_stop' };
        yield { type: 'message_stop' };
      }
    }))
  }
};

// src/__tests__/__mocks__/claude-code-sdk.ts
export const mockClaudeCodeQuery = jest.fn().mockImplementation(async function* () {
  yield { type: 'assistant', content: 'Test response' };
  yield { type: 'result', result: 'success' };
});
```

#### ACP Connection Mocks
```typescript
// src/__tests__/__mocks__/acp-connection.ts
export class MockAgentSideConnection {
  sendSessionUpdate = jest.fn();
  requestPermission = jest.fn().mockResolvedValue({ choice: 'allow_once' });
  readFile = jest.fn();
  writeFile = jest.fn();
}
```

### E2E Tests

#### Zed Integration Tests (Optional)
- **Purpose**: Validate actual Zed integration works correctly
- **Scope**: Basic initialization and simple prompts only
- **Implementation**: Automated Zed instance with test scenarios
- **Note**: Requires Zed test harness - may be implemented as manual verification initially

### Test Documentation
Each test includes comprehensive purpose comments:
```typescript
/**
 * PURPOSE: Validates that the ACP agent correctly negotiates protocol capabilities
 * during initialization, ensuring compatibility with Zed's expected protocol version
 * and feature set.
 * 
 * VALIDATES: Protocol version compatibility, capability advertisement accuracy
 * CAN FAIL IF: Protocol versions mismatch, capabilities are incorrectly advertised
 */
it('should negotiate correct protocol version', async () => {
  // Test implementation
});
```

### Meaningful Test Requirements
- **No Always-Pass Tests**: Every test must have failure conditions
- **Edge Case Coverage**: Permission denials, network failures, cancellation scenarios
- **Real Error Testing**: Actual error conditions that could occur in production
- **State Validation**: Verify internal state changes correctly reflect operations

## Performance Considerations

### Streaming Optimization
- **Chunked Response Handling**: Process Claude Code SDK streaming messages in batches to reduce ACP message frequency
- **Buffer Management**: Implement intelligent buffering for tool output to balance responsiveness with message overhead
- **Memory Management**: Properly dispose of completed sessions and clean up resources

### Resource Usage
- **Session Limits**: Implement configurable limits on concurrent sessions (default: 3)
- **Message Size Limits**: Respect ACP message size constraints for large file operations
- **CPU Usage**: Monitor and throttle excessive tool execution if needed

### Scalability Considerations
- **Session Cleanup**: Automatic cleanup of abandoned sessions after timeout
- **Error Recovery**: Graceful degradation when Claude Code SDK encounters issues
- **Rate Limiting**: Respect Anthropic API rate limits through SDK configuration

## Security Considerations

### Permission Model
- **Principle of Least Privilege**: Only request permissions actually needed for each operation
- **Permission Granularity**: Granular permission requests per tool invocation rather than blanket approvals
- **User Control**: Clear permission dialogs with detailed explanations of requested actions

### Data Handling
- **No Credential Storage**: Never store Anthropic API keys or other credentials in the agent
- **Secure Communication**: All communication between components uses established secure channels
- **Input Validation**: Strict validation of all ACP messages and Claude Code SDK responses

### File System Security
- **Path Validation**: Validate all file paths to prevent directory traversal attacks
- **Permission Boundaries**: Respect Zed's file access permissions and user workspace boundaries
- **Temporary File Handling**: Secure handling of any temporary files created during operation

### API Security
- **Error Information**: Avoid leaking sensitive information in error messages
- **Input Sanitization**: Sanitize user inputs before passing to Claude Code SDK
- **Audit Trail**: Log security-relevant operations for debugging and monitoring

## Documentation

### Developer Documentation
- **README.md**: Setup instructions, configuration options, troubleshooting
- **API.md**: Detailed API documentation for extension developers
- **ARCHITECTURE.md**: In-depth technical architecture documentation
- **CONTRIBUTING.md**: Guidelines for contributing to the project

### User Documentation
- **Zed Integration Guide**: Step-by-step setup instructions for Zed users
- **Permission Guide**: Explanation of permission system and security model
- **Troubleshooting Guide**: Common issues and solutions
- **Configuration Reference**: Complete configuration options reference

### Code Documentation
- **TypeScript DocComments**: Comprehensive JSDoc comments for all public APIs
- **Inline Comments**: Clear explanations for complex logic and protocol translations
- **Example Code**: Working examples for common use cases and customization

## Implementation Phases

### Phase 1: Core ACP Agent (MVP)
**Deliverables:**
- Basic ACP server implementation with protocol negotiation
- Simple session management (create, prompt, basic responses)
- Text-only content support (no images initially)
- Basic error handling and graceful failures
- Simple permission bridge with allow/deny only
- File system integration using Option A (lightweight proxy)

**Validation Criteria:**
- Successfully connects to Zed as external agent
- Handles simple text prompts and responses
- Basic tool execution with permission requests
- Graceful error handling and cleanup

### Phase 2: Advanced Features
**Deliverables:**
- Image content support through streaming input
- Enhanced permission system with granular controls
- Session resume/continue functionality  
- Full tool suite integration (Bash, file operations, search)
- Comprehensive error handling and recovery
- Performance optimizations and resource management

**Validation Criteria:**
- Full feature parity with Claude Code CLI experience
- Robust permission handling with all options
- Session state persistence and resume functionality
- Performance meets responsiveness requirements

### Phase 3: Production Polish
**Deliverables:**
- Full file system proxy implementation (Option B)
- Advanced MCP server integration
- Comprehensive logging and debugging tools
- Performance monitoring and optimization
- Complete test suite with high coverage
- Production-ready error handling and monitoring

**Validation Criteria:**
- Production-ready stability and performance
- Comprehensive test coverage (>90%)
- Complete documentation and user guides
- Security audit and validation completed

## Open Questions

### Technical Decisions
1. **Permission Granularity**: Should we implement per-tool permission caching or request approval for each operation?
2. **Session State**: How long should we maintain session state for potential resume operations?
3. **Error Recovery**: Should we implement automatic retry logic for transient failures?
4. **File System Strategy**: Should MVP use Option A or B for file system integration?

### Integration Concerns
1. **Zed Version Compatibility**: How do we handle ACP protocol evolution across Zed versions?
2. **Performance Expectations**: What are the acceptable response time thresholds for tool execution?
3. **Resource Limits**: Should we implement configurable resource limits for different deployment scenarios?

### User Experience
1. **Permission UX**: How detailed should permission request dialogs be?
2. **Error Presentation**: How should we present Claude Code SDK errors to users in Zed's interface?
3. **Configuration**: Should we support per-project configuration files?

## References

### Protocol Documentation
- [Agent Client Protocol Specification](https://agentclientprotocol.com/protocol/overview)
- [ACP TypeScript Library](https://agentclientprotocol.com/libraries/typescript)
- [ACP Tool Calls Documentation](https://agentclientprotocol.com/protocol/tool-calls)
- [ACP File System Integration](https://agentclientprotocol.com/protocol/file-system)

### Claude Code Integration  
- [Claude Code TypeScript SDK](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript)
- [Claude Code Settings and Configuration](https://docs.anthropic.com/en/docs/claude-code/settings)

### Supporting Technologies
- [Model Context Protocol Documentation](https://modelcontextprotocol.io/docs)
- [Zed External Agents Guide](https://zed.dev/docs/ai/external-agents)

### Related Projects
- [MCP Bridge API](https://github.com/modelcontextprotocol/bridge) - MCP-HTTP bridge reference
- [ACP Examples](https://github.com/zed-industries/agent-client-protocol/tree/main/examples) - Official ACP examples
