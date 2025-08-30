# Claude Code ACP Agent for Zed Editor

Enable Claude Code as an AI assistant in Zed Editor via the Agent Client Protocol.

## Installation

### From npm
```bash
npm install -g claude-code-acp
```

### From source
```bash
git clone https://github.com/carlrannaberg/cc-acp
cd cc-acp
npm install
npm run build
npm link
```

## Zed Configuration

Add to your Zed settings.json:

**Option 1: Use your Claude Code subscription (recommended)**
```json
{
  "agent_servers": {
    "Claude Code": {
      "command": "claude-code-acp",
      "args": [],
      "env": {}
    }
  }
}
```

**Option 2: Use a separate API key**
```json
{
  "agent_servers": {
    "Claude Code": {
      "command": "claude-code-acp",
      "args": [],
      "env": {
        "CLAUDE_API_KEY": "sk-ant-your-api-key"
      }
    }
  }
}
```

### Configure SDK via environment

Prefer environment variables to control the Claude Code SDK. Example (enable specific tools, set model and turns):

```json
{
  "agent_servers": {
    "Claude Code": {
      "command": "claude-code-acp",
      "env": {
        "ACP_LOG_LEVEL": "debug",
        "CLAUDE_MODEL": "sonnet",
        "CLAUDE_ALLOWED_TOOLS": "Read,Edit",
        "CLAUDE_MAX_TURNS": "40"
      }
    }
  }
}
```

## Basic Usage

1. Open Zed Editor
2. Open the Assistant panel (Cmd+?)
3. Start a conversation with Claude Code
4. Reference files with @filename or drag and drop

## Environment Variables

- `CLAUDE_API_KEY`: Your Anthropic API key (optional - only needed if not using Claude Code subscription)
- `DEBUG`: Enable debug logging (optional)
- `ACP_LOG_LEVEL`: Set log level: error|warn|info|debug (optional)
- `ACP_TIMEOUT`: Session timeout in milliseconds (default: 1800000)
- `MAX_SESSIONS`: Maximum concurrent sessions (default: 10)
- `SESSION_TIMEOUT_MS`: Session timeout in milliseconds (default: 3600000)
- `ENABLE_SMART_SEARCH`: Enable glob fallback for file resolution (default: true)
- `RESPECT_GITIGNORE`: Filter files by gitignore rules (default: true)
- `CLAUDE_MAX_TURNS` (optional): If set, limits internal reasoning/tool turns per prompt turn. If unset, the SDK's default behavior is used.

Additional optional SDK passthrough variables:

- `CLAUDE_MODEL`: Preferred model name for Claude Code SDK
- `CLAUDE_FALLBACK_MODEL`: Fallback model to use when primary model unavailable
- `CLAUDE_CUSTOM_SYSTEM_PROMPT`: Replace the SDK’s system prompt
- `CLAUDE_APPEND_SYSTEM_PROMPT`: Append text to the system prompt
- `CLAUDE_ADDITIONAL_DIRS`: Comma-separated list of directories to add to project context
- `CLAUDE_PERMISSION_MODE`: One of `default|acceptEdits|bypassPermissions|plan`
- `CLAUDE_ALLOWED_TOOLS`: Comma-separated allowlist of tools (e.g., `Read,Edit`)
- `CLAUDE_DISALLOWED_TOOLS`: Comma-separated blocklist of tools
- `CLAUDE_STRICT_MCP_CONFIG`: `true` to enforce strict MCP server config
- `CLAUDE_MAX_TURNS`: Optional max internal reasoning/tool turns per prompt turn
- `CLAUDE_MAX_THINKING_TOKENS`: Maximum tokens for Claude's thinking process

Notes:
- By default, we do not enable any tools (`allowedTools` is empty) unless you specify them via flags or env.
- We only pass `maxTurns` to the SDK when `CLAUDE_MAX_TURNS` is set (no default cap from the agent).
- The agent resolves the SDK CLI path internally and passes your session CWD.

## Features

### Intelligent File Resolution
- Direct file path resolution
- Glob pattern fallback for fuzzy matching
- Gitignore-aware file filtering
- Smart search capabilities

### Session Management
- Multiple concurrent sessions
- Automatic session cleanup
- Session timeout handling
- Graceful cancellation

### Permission System
- Fine-grained tool execution permissions
- Interactive permission requests
- Safe file system access
- Configurable security policies

### Protocol Support
- Full ACP v1 protocol implementation
- Streaming responses
- Tool call handling
- Error recovery

## Troubleshooting

### Agent not responding
- Check API key is set correctly: `echo $CLAUDE_API_KEY`
- Verify claude-code-acp is in PATH: `which claude-code-acp`
- Check Zed logs: `~/Library/Logs/Zed/Zed.log` (macOS) or `~/.local/state/zed/log` (Linux)
- Test agent directly: `claude-code-acp --help`

### Permission dialogs not appearing
- Ensure Zed is up to date (v0.162.0+)
- Check assistant.provider settings are correct
- Verify command path is absolute or in PATH

### File references not working
- Use relative paths from project root
- Ensure files are within project bounds
- Check gitignore settings if files are hidden
- Enable debug mode: `DEBUG=true claude-code-acp`

### Connection issues
- Check stdin/stdout are not being used by other processes
- Verify no conflicting ACP agents are running
- Test with minimal configuration first

### Performance issues
- Reduce MAX_SESSIONS for constrained environments
- Adjust SESSION_TIMEOUT_MS for shorter sessions
- Disable ENABLE_SMART_SEARCH if not needed

## Advanced Configuration

### Custom Config File
```bash
claude-code-acp --config /path/to/config.json
```

Config file format:
```json
{
  "maxSessions": 5,
  "sessionTimeoutMs": 1800000,
  "enableSmartSearch": true,
  "respectGitignore": true,
  "debug": false
}
```

### Debug Mode
Enable detailed logging:
```bash
export ACP_LOG_LEVEL=debug
export DEBUG=true
claude-code-acp
```

### Security Settings
For restricted environments:
```bash
export ENABLE_SMART_SEARCH=false
export RESPECT_GITIGNORE=true
export MAX_SESSIONS=3
```

### SDK environment variables (full list)

Set any of the following under Zed’s `agent_servers.<name>.env` to control the SDK:

- `CLAUDE_MODEL`: Preferred model name for Claude Code SDK
- `CLAUDE_FALLBACK_MODEL`: Fallback model
- `CLAUDE_CUSTOM_SYSTEM_PROMPT`: Replace the SDK’s system prompt
- `CLAUDE_APPEND_SYSTEM_PROMPT`: Append text to the system prompt
- `CLAUDE_ADDITIONAL_DIRS`: Comma-separated list of directories to add
- `CLAUDE_PERMISSION_MODE`: One of `default|acceptEdits|bypassPermissions|plan`
- `CLAUDE_PERMISSION_PROMPT_TOOL`: Permission prompt tool name
- `CLAUDE_EXECUTABLE`: Runtime for the SDK CLI (`node|bun|deno`)
- `CLAUDE_EXEC_ARGS`: Comma-separated additional args for the runtime
- `CLAUDE_ALLOWED_TOOLS`: Comma-separated allowlist of tools (e.g., `Read,Edit`)
- `CLAUDE_DISALLOWED_TOOLS`: Comma-separated blocklist
- `CLAUDE_STRICT_MCP_CONFIG`: `true` to enforce strict MCP server config
- `CLAUDE_EXTRA_ARGS`: JSON of extra CLI flags for the SDK (e.g., `{"print":null}`)
- `CLAUDE_MAX_TURNS`: Optional max internal reasoning/tool turns per prompt turn

## Development

### Building from source
```bash
npm run build
```

### Running tests
```bash
npm test
```

### Type checking
```bash
npm run typecheck
```

### Development mode with watch
```bash
npm run dev
```

## Architecture

The agent consists of several layers:

- **Protocol Layer**: JSON-RPC communication with Zed
- **Bridge Layer**: ACP protocol implementation and session management
- **File Intelligence**: Smart file resolution and filesystem access
- **Permission System**: Security and user consent management

For detailed architecture information, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## API Reference

For developers building extensions or integrating with this agent, see [API.md](./API.md).

## License

MIT License - see package.json for details.

## Support

- GitHub Issues: [Report bugs or feature requests](https://github.com/carlrannaberg/cc-acp/issues)
- Documentation: Check troubleshooting section above
- Debug Mode: Enable with `ACP_LOG_LEVEL=debug` for detailed logs
