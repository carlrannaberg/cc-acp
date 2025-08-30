# AGENTS.md
This file provides guidance to AI coding assistants working in this repository.

**Note:** CLAUDE.md, .clinerules, .cursorrules, .windsurfrules, .replit.md, GEMINI.md, .github/copilot-instructions.md, and .idx/airules.md are symlinks to AGENTS.md in this project.

# Claude Code ACP Agent

A high-performance Agent Client Protocol (ACP) implementation that enables Claude Code to work as an AI assistant within Zed Editor. This bridge provides seamless integration between Claude's AI capabilities and Zed's editor environment via JSON-RPC 2.0 protocol.

## Build & Commands

**Development:**
- Build production: `npm run build` (minified bundle)
- Build development: `npm run build:dev` (with sourcemaps)
- Watch mode: `npm run dev` (rebuilds on changes)

**Testing:**
- Run tests: `npm test`
- Test with coverage: `npm run test:coverage`
- Run specific test file: `npm test -- path/to/test.ts`
- Run tests in watch mode: `npm test -- --watch`

**Code Quality:**
- Type checking: `npm run typecheck`
- Linting: `npm run lint`
- Fix linting issues: `npm run lint -- --fix`

**Release & Publishing:**
- Patch release: `npm run release` (1.0.0 → 1.0.1)
- Minor release: `npm run release:minor` (1.0.0 → 1.1.0)
- Major release: `npm run release:major` (1.0.0 → 2.0.0)

**Other:**
- Install dependencies: `npm install`
- Clean install: `npm ci`
- Link for local development: `npm link`
- Pre-publish validation: `npm run prepublishOnly`

### Script Command Consistency
**Important**: When modifying npm scripts in package.json, ensure all references are updated:
- GitHub Actions workflows (.github/workflows/ci.yml)
- README.md documentation
- Release scripts (scripts/release.sh)
- Contributing documentation (CONTRIBUTING.md)
- This AGENTS.md file

## Code Style

### TypeScript Configuration
- **Target**: ES2022 with CommonJS modules
- **Strict Mode**: Enabled (all strict type checks)
- **Module Resolution**: Node.js style
- **Import Extensions**: Use `.js` extensions for local imports (even for `.ts` files)

### Import Conventions
```typescript
// External dependencies - no extensions
import { z } from 'zod';
import { Claude } from '@anthropic-ai/claude-code';

// Local imports - MUST use .js extension
import { ACPAgent } from './bridge/agent.js';
import { FileResolver } from '../files/resolver.js';

// Type imports - use type keyword
import type { ACPMessage, ToolCall } from './types.js';
```

### Naming Conventions
- **Files**: kebab-case (e.g., `file-resolver.ts`, `error-handler.ts`)
- **Classes**: PascalCase (e.g., `ACPAgent`, `SessionManager`)
- **Interfaces/Types**: PascalCase with descriptive suffixes (e.g., `ACPMessage`, `ToolOptions`)
- **Functions**: camelCase (e.g., `parseMessage`, `handleError`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`, `DEFAULT_TIMEOUT`)
- **Private methods**: prefix with underscore (e.g., `_processInternal`)

### Error Handling Patterns
```typescript
// Use custom error classes with proper error codes
class ACPError extends Error {
  constructor(message: string, public code: number = -32603) {
    super(message);
    this.name = 'ACPError';
  }
}

// Always handle async errors
try {
  const result = await operation();
} catch (error) {
  logger.error('Operation failed', { error });
  throw new ACPError('Operation failed', ErrorCodes.INTERNAL_ERROR);
}

// Use Result pattern for expected failures
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
```

### Type Usage Patterns
- **Prefer interfaces** for object shapes that might be extended
- **Use type aliases** for unions, intersections, and utility types
- **Always use strict types** - avoid `any`, use `unknown` when type is truly unknown
- **Use Zod schemas** for runtime validation of external data
- **Export types** that are part of the public API

### Code Organization
- **One class/major function per file**
- **Group related functionality in directories**
- **Keep files under 300 lines** (split large files)
- **Colocate tests** in `__tests__` directories
- **Export through index files** for clean imports

## Testing

### Framework & Configuration
- **Framework**: Jest with ts-jest
- **Test Environment**: Node.js
- **Test Timeout**: 30 seconds
- **Coverage Requirements**: Aim for >80% coverage

### Test File Patterns
- Unit tests: `src/**/__tests__/*.test.ts`
- Integration tests: `tests/**/*.test.ts`
- Test utilities: `src/**/__tests__/helpers/*.ts`

### Testing Conventions
```typescript
// Describe blocks for grouping
describe('ACPAgent', () => {
  describe('initialization', () => {
    it('should initialize with default options', () => {
      // Test implementation
    });
  });
});

// Use meaningful test descriptions
it('should handle network errors with exponential backoff', async () => {
  // Not: "should work" or "test error"
});

// Setup and teardown
beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  // Cleanup
});
```

### Testing Philosophy
**When tests fail, fix the code, not the test.**

Key principles:
- **Tests should be meaningful** - Avoid tests that always pass regardless of behavior
- **Test actual functionality** - Call the functions being tested, don't just check side effects
- **Failing tests are valuable** - They reveal bugs or missing features
- **Fix the root cause** - When a test fails, fix the underlying issue, don't hide the test
- **Test edge cases** - Tests that reveal limitations help improve the code
- **Document test purpose** - Each test should include a comment explaining why it exists and what it validates

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test -- src/__tests__/cli.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="version"

# Run with coverage
npm run test:coverage

# Run in watch mode
npm test -- --watch

# Debug tests
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Security

### API Key Management
- **Never commit API keys** - Use environment variables
- **Validate API keys** early in the application lifecycle
- **Mask API keys** in logs (show only last 4 characters)
- **Rotate keys regularly** and support multiple keys

### Path Security
- **Validate all file paths** to prevent directory traversal
- **Use path.resolve()** to normalize paths
- **Check path boundaries** - ensure paths stay within workspace
- **Sanitize user input** before using in file operations

### Permission System
- **Granular permissions** for each tool/operation
- **User approval required** for destructive operations
- **Permission caching** with TTL to avoid repeated prompts
- **Audit logging** for all permission grants/denials

### Data Protection
- **No sensitive data in logs** - sanitize before logging
- **Secure communication** - validate JSON-RPC messages
- **Input validation** - use Zod schemas for all external data
- **Rate limiting** - protect against resource exhaustion

## Directory Structure & File Organization

```
claude-code-acp/
├── src/                    # Source code
│   ├── bridge/            # ACP bridge implementation
│   │   ├── agent.ts      # Main agent class
│   │   ├── session.ts    # Session management
│   │   └── permissions.ts # Permission system
│   ├── protocol/          # Protocol implementation
│   │   ├── connection.ts # JSON-RPC connection
│   │   └── schemas.ts    # Zod validation schemas
│   ├── files/            # File system operations
│   │   ├── resolver.ts  # Smart file resolution
│   │   └── filesystem.ts # File system proxy
│   ├── utils/            # Utilities
│   │   ├── errors.ts    # Error handling
│   │   ├── path.ts      # Path utilities
│   │   ├── performance.ts # Performance monitoring
│   │   └── types.ts     # Shared types
│   ├── __tests__/        # Unit tests
│   └── index.ts          # CLI entry point
├── tests/                 # Integration tests
├── reports/              # Project reports
├── temp/                 # Temporary files (gitignored)
├── .claude/              # Claude Code configuration
│   ├── agents/          # Available subagents
│   ├── commands/        # Custom commands
│   └── settings.json    # Team settings
├── .github/              # GitHub configuration
│   └── workflows/       # CI/CD pipelines
├── dist/                 # Build output (gitignored)
├── coverage/            # Test coverage (gitignored)
└── node_modules/        # Dependencies (gitignored)
```

### Reports Directory
ALL project reports and documentation should be saved to the `reports/` directory:

**Implementation Reports:**
- Phase validation: `reports/PHASE_X_VALIDATION_REPORT.md`
- Implementation summaries: `reports/IMPLEMENTATION_SUMMARY_[FEATURE].md`
- Feature completion: `reports/FEATURE_[NAME]_REPORT.md`

**Testing & Analysis Reports:**
- Test results: `reports/TEST_RESULTS_[DATE].md`
- Coverage reports: `reports/COVERAGE_REPORT_[DATE].md`
- Performance analysis: `reports/PERFORMANCE_ANALYSIS_[SCENARIO].md`
- Security scans: `reports/SECURITY_SCAN_[DATE].md`

**Quality & Validation:**
- Code quality: `reports/CODE_QUALITY_REPORT.md`
- Dependency analysis: `reports/DEPENDENCY_REPORT.md`
- API compatibility: `reports/API_COMPATIBILITY_REPORT.md`

**Report Naming Conventions:**
- Use descriptive names: `[TYPE]_[SCOPE]_[DATE].md`
- Include dates: `YYYY-MM-DD` format
- Group with prefixes: `TEST_`, `PERFORMANCE_`, `SECURITY_`
- Markdown format: All reports end in `.md`

### Temporary Files & Debugging
All temporary files, debugging scripts, and test artifacts should be organized in a `/temp` folder:

**Temporary File Organization:**
- **Debug scripts**: `temp/debug-*.js`, `temp/analyze-*.py`
- **Test artifacts**: `temp/test-results/`, `temp/coverage/`
- **Generated files**: `temp/generated/`, `temp/build-artifacts/`
- **Logs**: `temp/logs/debug.log`, `temp/logs/error.log`

**Guidelines:**
- Never commit files from `/temp` directory
- Use `/temp` for all debugging and analysis scripts created during development
- Clean up `/temp` directory regularly or use automated cleanup
- Include `/temp/` in `.gitignore` to prevent accidental commits

### Claude Code Settings (.claude Directory)

The `.claude` directory contains Claude Code configuration files with specific version control rules:

#### Version Controlled Files (commit these):
- `.claude/settings.json` - Shared team settings for hooks, tools, and environment
- `.claude/commands/*.md` - Custom slash commands available to all team members
- `.claude/hooks/*.sh` - Hook scripts for automated validations and actions
- `.claude/agents/*.md` - Specialized agent configurations

#### Ignored Files (do NOT commit):
- `.claude/settings.local.json` - Personal preferences and local overrides
- Any `*.local.json` files - Personal configuration not meant for sharing

**Important Notes:**
- Claude Code automatically adds `.claude/settings.local.json` to `.gitignore`
- The shared `settings.json` should contain team-wide standards (linting, type checking, etc.)
- Personal preferences or experimental settings belong in `settings.local.json`
- Hook scripts in `.claude/hooks/` should be executable (`chmod +x`)

## Configuration

### Environment Variables
```bash
# Required
CLAUDE_API_KEY=sk-ant-...        # Claude API key

# Optional
ACP_TIMEOUT=30000                 # Request timeout in ms (default: 30000)
ACP_LOG_LEVEL=debug              # Log level: error|warn|info|debug (default: info)
ACP_WORKSPACE=/path/to/workspace # Workspace root (default: current directory)
ACP_MAX_FILE_SIZE=1048576        # Max file size in bytes (default: 1MB)
ACP_CACHE_TTL=300000             # Cache TTL in ms (default: 5 minutes)
```

### Configuration Files
- **tsconfig.json** - TypeScript compiler configuration
- **jest.config.js** - Jest testing configuration
- **eslint.config.js** - ESLint linting rules
- **package.json** - Project metadata and scripts
- **.npmignore** - Files to exclude from npm package
- **.gitignore** - Files to exclude from git

### Development Setup
```bash
# Clone repository
git clone https://github.com/carlrannaberg/cc-acp
cd cc-acp

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your API key

# Build project
npm run build

# Run tests
npm test

# Start development mode
npm run dev
```

## Agent Delegation & Tool Execution

### ⚠️ MANDATORY: Always Delegate to Specialists & Execute in Parallel

**When specialized agents are available, you MUST use them instead of attempting tasks yourself.**

**When performing multiple operations, send all tool calls (including Task calls for agent delegation) in a single message to execute them concurrently for optimal performance.**

### Available Specialized Agents

This project includes numerous specialized agents in `.claude/agents/`:

#### Core Development Agents
- **typescript-expert**: TypeScript language features, type system, configurations
- **typescript-build-expert**: TypeScript build optimization and configuration
- **typescript-type-expert**: Advanced type system and generic programming
- **nodejs-expert**: Node.js runtime, async patterns, streams, process management
- **jest-testing-expert**: Jest testing framework and mocking strategies
- **testing-expert**: Cross-framework testing knowledge

#### Code Quality Agents
- **code-review-expert**: Comprehensive code review across 6 aspects
- **refactoring-expert**: Systematic code refactoring and optimization
- **linting-expert**: Code linting and formatting standards
- **documentation-expert**: Documentation structure and quality

#### Infrastructure Agents
- **docker-expert**: Docker containerization and orchestration
- **github-actions-expert**: GitHub Actions CI/CD pipelines
- **devops-expert**: General DevOps and infrastructure

#### Web Development Agents
- **react-expert**: React components and hooks
- **react-performance-expert**: React performance optimization
- **nextjs-expert**: Next.js framework and SSR
- **css-styling-expert**: CSS architecture and styling
- **accessibility-expert**: WCAG compliance and accessibility

#### Database Agents
- **database-expert**: Cross-database expertise
- **postgres-expert**: PostgreSQL optimization
- **mongodb-expert**: MongoDB and NoSQL patterns

#### Specialized Tools
- **git-expert**: Git workflows and conflict resolution
- **cli-expert**: CLI tool development
- **ai-sdk-expert**: Vercel AI SDK implementation
- **research-expert**: Parallel information gathering
- **triage-expert**: Initial problem diagnosis
- **code-search**: Focused codebase searching

### Usage Examples

```bash
# Delegate to TypeScript expert for type issues
Task: typescript-type-expert
"Fix the complex generic type inference issue in src/utils/types.ts"

# Parallel delegation for comprehensive review
Task: code-review-expert + testing-expert + typescript-expert
"Review the new session management implementation"

# Use triage expert when scope is unclear
Task: triage-expert
"Application is running slowly after recent changes"
```

### Critical: Always Use Parallel Tool Calls

**IMPORTANT: Send all tool calls in a single message to execute them in parallel.**

**These cases MUST use parallel tool calls:**
- Multiple file reads or searches
- Multiple grep searches with different patterns
- Multiple agent delegations
- Any independent information gathering

**Performance Impact:** Parallel execution is 3-5x faster than sequential calls.

## Project-Specific Guidelines

### ACP Protocol Implementation
- Follow the Zed Editor ACP specification exactly
- All messages must validate against Zod schemas
- Handle partial messages and streaming correctly
- Implement proper error codes per JSON-RPC 2.0

### Performance Requirements
- Response time: <100ms for most operations
- Memory usage: <512MB under normal load
- Support 10+ concurrent sessions
- File operations should use streaming for large files

### Integration Points
- **Zed Editor**: Primary integration via stdin/stdout
- **Claude SDK**: AI completions and conversations
- **File System**: Smart resolution and caching
- **Permission System**: User approval for operations

### Common Tasks

#### Adding a New Tool
1. Define schema in `src/protocol/schemas.ts`
2. Implement handler in `src/bridge/session.ts`
3. Add permission check in `src/bridge/permissions.ts`
4. Write tests in `src/__tests__/`
5. Update API documentation

#### Debugging Connection Issues
1. Set `ACP_LOG_LEVEL=debug`
2. Check `temp/logs/` for detailed logs
3. Verify JSON-RPC message format
4. Test with minimal reproduction case

#### Performance Optimization
1. Profile with `npm run profile`
2. Check for unnecessary file reads
3. Optimize Zod schema validation
4. Use caching for repeated operations

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed contribution guidelines.

### Quick Start for Contributors
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm test` and `npm run typecheck`
5. Submit a pull request

### Code Review Checklist
- [ ] Tests pass (`npm test`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Linting passes (`npm run lint`)
- [ ] Documentation updated
- [ ] Performance impact considered
- [ ] Security implications reviewed

## Resources

- [Project Repository](https://github.com/carlrannaberg/cc-acp)
- [Zed Editor ACP Docs](https://zed.dev/docs/extensions/agent-client-protocol)
- [Claude SDK Documentation](https://docs.anthropic.com/claude/sdks)
- [Architecture Overview](ARCHITECTURE.md)
- [API Reference](API.md)
- [Performance Guide](PERFORMANCE_OPTIMIZATIONS.md)

## Support

- **Issues**: [GitHub Issues](https://github.com/carlrannaberg/cc-acp/issues)
- **Discussions**: [GitHub Discussions](https://github.com/carlrannaberg/cc-acp/discussions)
- **Security**: Report security issues privately via GitHub Security tab

## Git Commit Conventions
Based on analysis of this project's git history:
- **Format**: Conventional commits with `type(scope): description`
- **Types**: `feat` (new features), `refactor` (code improvements), `fix` (bug fixes), `docs` (documentation)
- **Scope**: Optional, use when changes are specific to a component (e.g., `specs`, `agent`, `protocol`)
- **Description**: Lowercase, imperative mood, no period
- **Examples**:
  - `feat: implement complete Claude Code ACP agent for Zed Editor`
  - `feat(specs): create realistic ACP agent spec based on Gemini CLI learnings`
  - `refactor(specs): simplify ACP agent spec to focused MVP`