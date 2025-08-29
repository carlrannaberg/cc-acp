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

```json
{
  "assistant": {
    "version": "2",
    "provider": {
      "name": "claude-code",
      "config": {
        "command": "claude-code-acp",
        "args": [],
        "env": {
          "CLAUDE_API_KEY": "your-api-key"
        }
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

- `CLAUDE_API_KEY`: Your Anthropic API key (required)
- `DEBUG`: Enable debug logging (optional)
- `ACP_LOG_LEVEL`: Set log level: error|warn|info|debug (optional)
- `ACP_TIMEOUT`: Session timeout in milliseconds (default: 1800000)
- `MAX_SESSIONS`: Maximum concurrent sessions (default: 10)
- `SESSION_TIMEOUT_MS`: Session timeout in milliseconds (default: 3600000)
- `ENABLE_SMART_SEARCH`: Enable glob fallback for file resolution (default: true)
- `RESPECT_GITIGNORE`: Filter files by gitignore rules (default: true)

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
claudeCodeACP --config /path/to/config.json
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
claudeCodeACP
```

### Security Settings
For restricted environments:
```bash
export ENABLE_SMART_SEARCH=false
export RESPECT_GITIGNORE=true
export MAX_SESSIONS=3
```

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