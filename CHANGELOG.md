# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2025-08-30

### Fixed
- Corrected README documentation to clarify package name (`claude-code-acp`) vs executable name (`cc-acp`)
- Fixed package.json bin path formatting issue flagged during npm publish

## [0.1.0] - 2025-08-30

Initial release of **cc-acp**, a Claude Code agent that enables AI-powered coding assistance directly within Zed Editor through the Agent Client Protocol (ACP). This release provides a production-ready agent with comprehensive file operations, intelligent code understanding, and seamless integration with Claude's AI capabilities.

### Core Features
- **ACP Integration**: Full Agent Client Protocol implementation for seamless Zed Editor integration
- **Claude SDK Integration**: AI-powered code assistance with streaming response support
- **File Operations**: Read, write, edit, and glob operations with smart path resolution
- **Permission System**: Secure tool execution with user approval for file modifications
- **Session Management**: Conversation history and context preservation across interactions
- **Project Navigation**: Smart file discovery with gitignore awareness and glob fallback
- **Error Recovery**: Robust operation with comprehensive error handling mechanisms

### Configuration & CLI
- Executable available as `cc-acp` command for convenient usage
- Comprehensive SDK configuration via environment variables
- Support for CLAUDE_MAX_TURNS, CLAUDE_MODEL, CLAUDE_PERMISSION_MODE, etc.
- Environment variable preference over command-line flags for clean configuration

### Development & Testing
- **TypeScript**: Full type safety with zero 'any' types throughout codebase
- **Testing**: Jest framework with 76 tests providing high coverage
- **Code Quality**: ESLint configuration and automated quality checks
- **Documentation**: Complete SDK reference documentation (overview, headless mode, TypeScript)
- **Build System**: Minified production builds with development mode support

### DevOps & Publishing
- Complete npm packaging setup with MIT license
- GitHub Actions CI/CD pipeline (Node.js 18.x, 20.x, 22.x)
- Automated release scripts with interactive version selection
- Professional package metadata and publishing configuration

### Architecture
- **Modular Design**: Extensible architecture for easy feature additions
- **Type Safety**: Full TypeScript implementation with comprehensive type checking
- **Code Quality**: Professional development practices with automated quality assurance

### Security & Performance
- **Security**: API key management, path validation, secure tool execution with user permissions
- **Performance**: LRU caching, request batching, streaming responses, optimized file operations
- **Reliability**: Enhanced debug logging, comprehensive error handling, robust operation