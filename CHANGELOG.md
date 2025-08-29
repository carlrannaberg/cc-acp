# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Complete npm packaging and publishing setup
- ESLint configuration for code quality
- GitHub Actions CI/CD pipeline with Node.js 18.x, 20.x, 22.x testing
- Automated release scripts with interactive version selection
- Comprehensive build scripts with minification and development modes
- Coverage reporting integration
- Professional npm package metadata and keywords

### Changed
- License changed from ISC to MIT
- Enhanced package.json with proper publishing configuration
- Improved build process with minification for production

### Security
- Added .npmignore to prevent source code and sensitive files from being published

## [1.0.0] - 2024-XX-XX

### Added
- Initial release of Claude Code ACP agent
- ACP (Agent Client Protocol) implementation for Zed Editor integration
- Claude SDK integration for AI-powered code assistance
- Smart file resolution with glob fallback for handling ambiguous file paths
- Permission management system for secure tool execution
- Session management with conversation history and context preservation
- Streaming response support for real-time AI interactions
- Comprehensive tool execution framework with user permission controls
- Gitignore awareness to respect project file exclusion rules
- Error recovery mechanisms for robust operation
- Performance optimizations with LRU caching and request batching
- TypeScript implementation with comprehensive type safety
- Jest testing framework with high coverage
- Integration with Zed Editor's agent system

### Features
- **File Operations**: Read, write, edit, and glob file operations
- **Code Analysis**: Intelligent code understanding and modification
- **Project Navigation**: Smart file discovery and workspace awareness
- **Security**: Path validation to prevent directory traversal attacks
- **Extensibility**: Modular architecture for easy feature additions

### Security
- API key management via environment variables
- Path validation to prevent directory traversal vulnerabilities
- Permission system requiring user approval for file modifications
- Secure tool execution with input validation

### Performance
- LRU caching for frequently accessed files
- Request batching to minimize API calls
- Streaming responses for better user experience
- Optimized glob patterns for fast file discovery