# Claude Code ACP Agent for Zed Editor - MVP Specification

## Status
Draft - Simplified MVP

## Authors
Claude Code Assistant  
Date: 2025-08-29

## Overview
A minimal bridge that enables Claude Code to run as an external agent within Zed Editor via the Agent Client Protocol (ACP). This implementation provides a direct, simple connection between Zed's ACP JSON-RPC interface and Claude Code's TypeScript SDK.

## Problem Statement
Zed Editor supports external AI agents through ACP. Claude Code provides powerful AI assistance but lacks Zed integration. This bridge solves that single problem: enabling Claude Code functionality within Zed.

## Goals
- Enable Claude Code text prompts from within Zed
- Stream responses back to Zed in real-time
- Handle permission requests for file operations
- Support cancellation of running operations

## Non-Goals
- Session persistence or resume functionality
- Image content support
- Resource monitoring or throttling
- Advanced permission caching
- Full file system proxy implementation
- MCP server integration

## Technical Dependencies
- **@zed-industries/agent-client-protocol**: `^0.1.2` - ACP TypeScript library
- **@anthropic-ai/claude-code**: `^1.0.96` - Claude Code SDK
- **Node.js 18+** - Required by Claude Code SDK
- **TypeScript 5.0+** - For development

## Architecture

### Simple Direct Bridge

```
┌─────────────────┐    ACP/JSON-RPC     ┌──────────────────┐
│   Zed Editor    │◄──────stdio──────────►│  Claude Bridge   │
│                 │                      │                  │
│                 │                      │ • ACP Handler    │
│                 │                      │ • Direct SDK     │
│                 │                      │ • Simple Perms   │
└─────────────────┘                      └──────────────────┘
                                                   │
                                                   ▼
                                         ┌──────────────────┐
                                         │ Claude Code SDK  │
                                         └──────────────────┘
```

### Single-File Implementation

**File: `src/index.ts`** (~200 lines total)

```typescript
import { AgentSideConnection } from '@zed-industries/agent-client-protocol';
import { query } from '@anthropic-ai/claude-code';

export class ClaudeACPBridge {
  private connection: AgentSideConnection;
  private sessions = new Map<string, AbortController>();

  constructor() {
    this.connection = new AgentSideConnection(process.stdin, process.stdout);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.connection.on('initialize', async (params) => ({
      protocolVersion: "0.1.0",
      promptCapabilities: { image: false, audio: false }
    }));

    this.connection.on('session/new', async (params) => {
      const sessionId = crypto.randomUUID();
      this.sessions.set(sessionId, new AbortController());
      return { sessionId };
    });

    this.connection.on('session/prompt', async (params) => {
      const controller = this.sessions.get(params.sessionId);
      if (!controller) throw new Error('Session not found');

      try {
        await this.handlePrompt(params.sessionId, params.content, controller);
      } catch (error) {
        await this.connection.sendSessionUpdate(params.sessionId, {
          type: 'error',
          message: error.message
        });
      }
    });

    this.connection.on('session/cancel', async (params) => {
      const controller = this.sessions.get(params.sessionId);
      controller?.abort();
      this.sessions.delete(params.sessionId);
    });
  }

  private async handlePrompt(
    sessionId: string, 
    content: ContentBlock[], 
    controller: AbortController
  ): Promise<void> {
    // Simple conversion: extract text from content blocks
    const prompt = content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Direct Claude SDK integration
    for await (const message of query({
      prompt,
      options: {
        abortController: controller,
        permissionMode: 'default',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit'],
        // Use inline permission handler
        onPermissionRequest: async (tool: string) => {
          return await this.requestPermission(sessionId, tool);
        }
      }
    })) {
      // Stream responses back to Zed
      if (message.type === 'assistant') {
        await this.connection.sendSessionUpdate(sessionId, {
          type: 'content',
          text: message.content
        });
      } else if (message.type === 'tool_use') {
        await this.connection.sendSessionUpdate(sessionId, {
          type: 'tool_call',
          tool: message.name,
          status: 'running'
        });
      }
    }
  }

  private async requestPermission(sessionId: string, tool: string): Promise<boolean> {
    const result = await this.connection.requestPermission(sessionId, {
      title: `Allow ${tool}?`,
      body: `Claude Code wants to execute ${tool}`,
      options: ['allow', 'deny']
    });
    return result.choice === 'allow';
  }

  async start(): Promise<void> {
    await this.connection.start();
  }
}

// Entry point
const bridge = new ClaudeACPBridge();
bridge.start().catch(console.error);
```

## Implementation Details

### Message Conversion
- **ACP → Claude**: Extract text from ContentBlocks, concatenate with newlines
- **Claude → ACP**: Map assistant messages to content updates, tool uses to tool calls

### Permission Handling
- Direct ACP permission requests (no MCP bridge)
- Simple allow/deny responses
- Inline permission callback in Claude SDK options

### Error Handling
- Wrap prompt handling in try/catch
- Send error updates to Zed on failures
- Abort controller cleanup on cancellation

### Session Management
- Simple Map of sessionId → AbortController
- No persistence across restarts
- Automatic cleanup on cancellation

## User Experience

### Setup
```bash
# Install globally
npm install -g claude-code-acp-agent

# Add to Zed settings.json
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

### Usage Flow
1. Select "Claude Code" from Zed's agent dropdown
2. Type text prompts in the AI panel
3. See streaming responses with syntax highlighting
4. Approve/deny tool execution when prompted
5. Cancel anytime with standard Zed controls

## Testing Strategy

### Focus: Integration Testing
Primary testing effort on actual protocol integration rather than unit tests.

### Essential Tests Only

**Integration Tests** (`test/integration.test.ts`):
```typescript
describe('Claude ACP Bridge Integration', () => {
  it('connects to Zed and negotiates protocol', async () => {
    // Test actual ACP connection and initialization
  });

  it('handles text prompt and streams response', async () => {
    // Test end-to-end prompt → response flow
  });

  it('requests permission for tool execution', async () => {
    // Test permission flow with actual ACP messages
  });

  it('handles cancellation gracefully', async () => {
    // Test abort controller propagation
  });

  it('recovers from Claude SDK errors', async () => {
    // Test error handling and recovery
  });
});
```

### Testing Approach
- Use real ACP connections where possible
- Mock only external services (Anthropic API)
- Focus on behavior, not implementation
- No coverage requirements - focus on confidence

## Documentation

### Essential Documentation Only

```
docs/
├── README.md           # Setup, usage, troubleshooting
└── TROUBLESHOOTING.md  # Common issues and solutions
```

### README.md Contents
- Installation instructions
- Zed configuration
- Basic usage examples
- Common error messages
- Environment variables

### Code Comments
- Minimal, only where behavior is non-obvious
- No comprehensive JSDoc requirements
- Clear variable and function names instead of comments

## Implementation Phases

### Phase 1: Core MVP (Week 1)
- Basic ACP connection and protocol negotiation
- Text prompt handling with streaming responses
- Simple permission requests
- Error handling and cancellation

**Success Criteria:**
- Can send prompts from Zed to Claude Code
- Responses stream back in real-time
- File operations request permission
- Cancellation works reliably

### Phase 2: Polish (Week 2)
- Improved error messages
- Basic retry logic for transient failures
- README and troubleshooting guide
- NPM package publication

### Stop and Gather Feedback
Wait for user feedback before adding any additional features.

## Technical Decisions (Resolved)

### Resolved Architecture Choices
- **File System**: Use Claude SDK's built-in file handling (no proxy)
- **Permissions**: Direct ACP calls (no MCP bridge)
- **Sessions**: One per request (no persistence)
- **Content**: Text only for MVP (no images)

### Implementation Constraints
- Single TypeScript file for core functionality
- Target ~200 lines of production code
- No external dependencies beyond the two SDKs
- No configuration files or complex setup

## Open Questions
None - all architecture decisions have been made to minimize complexity.

## Success Metrics
1. **Works**: Users can use Claude Code in Zed
2. **Simple**: <300 lines of code total
3. **Reliable**: Handles errors gracefully
4. **Fast**: <2 week implementation

## References
- [Agent Client Protocol](https://agentclientprotocol.com/protocol/overview)
- [Claude Code TypeScript SDK](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript)
- [Zed External Agents](https://zed.dev/docs/ai/external-agents)