# Contributing to Claude Code ACP

We welcome contributions to the Claude Code ACP Agent! This guide will help you set up your development environment and understand our contribution process.

## Development Setup

### Prerequisites
- Node.js 18+ (for modern JavaScript features)
- npm or yarn package manager
- Zed Editor (for integration testing)
- Git for version control

### Initial Setup
```bash
# Clone the repository
git clone https://github.com/carlrannaberg/cc-acp
cd cc-acp

# Install dependencies
npm install

# Build the project
npm run build

# Link for local development
npm link
```

### Development Workflow

#### Local Development
```bash
# Start development mode with file watching
npm run dev

# In another terminal, test your changes
echo '{"method": "initialize", "params": {"protocolVersion": 1}}' | node dist/index.js
```

#### Testing with Zed
1. Build and link your local version:
   ```bash
   npm run build && npm link
   ```

2. Configure Zed to use your local build:
   ```json
   {
     "assistant": {
       "version": "2",
       "provider": {
         "name": "claude-code-local",
         "config": {
           "command": "claude-code-acp",
           "args": [],
           "env": {
             "CLAUDE_API_KEY": "your-api-key",
             "DEBUG": "true",
             "ACP_LOG_LEVEL": "debug"
           }
         }
       }
     }
   }
   ```

3. Test integration:
   - Open Zed Editor
   - Open Assistant panel (Cmd+?)
   - Verify connection and test basic functionality

## Testing Guidelines

### Running Tests
```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- src/__tests__/schemas.test.ts
```

### Test Categories

#### Unit Tests
Test individual components in isolation:
- **Protocol validation**: Schema parsing and validation logic
- **File resolution**: Path resolution algorithms and fallbacks
- **Permission logic**: Security decision trees
- **Error handling**: Error transformation and recovery

**Example unit test structure:**
```typescript
describe('FileResolver', () => {
  it('should resolve direct file paths', async () => {
    // Test implementation
  });
  
  it('should fallback to glob search when file not found', async () => {
    // Test implementation
  });
});
```

#### Integration Tests
Test component interactions:
- **Protocol communication**: ACP message round trips
- **Session lifecycle**: Create, use, and cleanup sessions
- **Claude SDK integration**: API calls and response handling
- **File system operations**: Read/write through ACP

#### Manual Testing Scenarios
1. **Basic conversation flow**:
   - Start conversation
   - Send simple prompt
   - Verify response

2. **File reference testing**:
   - Reference existing files with @filename
   - Test drag-and-drop file references
   - Try invalid file paths

3. **Tool execution**:
   - Request file modifications
   - Test permission dialogs
   - Verify tool results

4. **Error scenarios**:
   - Invalid API key
   - Network connectivity issues
   - Permission denied scenarios
   - Session timeout handling

### Test Coverage Goals
- **Unit tests**: 80% line coverage minimum
- **Integration tests**: Cover all major user flows
- **Error paths**: Test all error conditions
- **Edge cases**: Boundary conditions and unusual inputs

## Code Style and Standards

### TypeScript Configuration
- **Strict mode enabled**: Full type safety
- **ES2022 target**: Modern JavaScript features
- **Module system**: ES modules with CommonJS compatibility
- **Path mapping**: Absolute imports from src root

### Code Formatting
```bash
# ESLint for code quality
npx eslint src/**/*.ts

# Prettier for formatting (if configured)
npx prettier --check src/**/*.ts
```

### Coding Conventions

#### Naming Conventions
- **Classes**: PascalCase (`ClaudeACPAgent`)
- **Functions/methods**: camelCase (`handleMethod`)
- **Constants**: UPPER_SNAKE_CASE (`JSON_RPC_ERRORS`)
- **Interfaces**: PascalCase with descriptive names (`ACPClient`)

#### Error Handling
- Always use structured error types
- Provide actionable error messages
- Include context for debugging
- Use appropriate ACP error codes

```typescript
// Good error handling
try {
  await operation();
} catch (error) {
  throw ErrorHandler.handle(error, {
    context: 'operation description',
    sessionId,
    additionalData: relevantData
  });
}
```

#### Documentation
- **JSDoc comments** for public APIs
- **Inline comments** for complex logic
- **README updates** for new features
- **Architecture docs** for design changes

### Commit Standards

#### Conventional Commits
We use conventional commits for clear history:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples**:
```
feat(session): add session timeout configuration
fix(protocol): handle malformed ACP messages gracefully
docs(api): update FileResolver documentation
test(integration): add end-to-end protocol tests
```

## Pull Request Process

### Before Submitting
1. **Create feature branch** from main:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/your-feature-name
   ```

2. **Implement your changes**:
   - Write code following style guidelines
   - Add appropriate tests
   - Update documentation

3. **Verify everything works**:
   ```bash
   npm run build
   npm test
   npm run typecheck
   ```

4. **Test with Zed Editor**:
   - Link local build: `npm link`
   - Configure Zed to use local agent
   - Test your changes manually

### PR Checklist

#### Code Quality
- [ ] All tests pass (`npm test`)
- [ ] TypeScript compilation succeeds (`npm run typecheck`)
- [ ] Code follows project conventions
- [ ] No console.log statements (use proper logging)
- [ ] Error handling is comprehensive

#### Documentation
- [ ] Public APIs are documented with JSDoc
- [ ] README updated for user-facing changes
- [ ] Architecture docs updated for design changes
- [ ] Breaking changes clearly documented

#### Testing
- [ ] New features have unit tests
- [ ] Integration tests cover new workflows
- [ ] Manual testing completed with Zed
- [ ] Edge cases and error conditions tested

#### Security
- [ ] No hardcoded secrets or API keys
- [ ] File system access is properly restricted
- [ ] Permission checks are in place
- [ ] Input validation for user data

### PR Description Template

```markdown
## Summary
Brief description of what this PR accomplishes.

## Changes
- List of specific changes made
- Include any breaking changes
- Mention new dependencies if added

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] Manual testing with Zed completed
- [ ] Error scenarios tested

## Documentation
- [ ] JSDoc comments updated
- [ ] README updated if needed
- [ ] Architecture docs updated if needed

## Breaking Changes
Describe any breaking changes and migration steps.
```

### Review Process
1. **Automated checks**: CI runs tests and type checking
2. **Code review**: Maintainers review code quality and design
3. **Testing verification**: Manual testing in various scenarios
4. **Documentation review**: Ensure docs are accurate and complete
5. **Merge**: Squash and merge after approval

## Development Tools

### Recommended VS Code Extensions
- TypeScript Importer
- ESLint
- Prettier
- Jest
- GitLens

### Debugging

#### Enable Debug Mode
```bash
export DEBUG=true
export ACP_LOG_LEVEL=debug
node dist/index.js
```

#### Debug with Zed
1. Set debug environment in Zed config
2. Monitor Zed logs: `tail -f ~/Library/Logs/Zed/Zed.log`
3. Check agent stderr output

#### Common Debug Scenarios
- **Protocol issues**: Enable ACP message logging
- **File resolution**: Check glob patterns and gitignore
- **Permission problems**: Trace permission request flow
- **Claude API**: Monitor API calls and responses

## Release Process

### Version Management
- Follow semantic versioning (SemVer)
- Update version in package.json
- Create git tags for releases
- Maintain CHANGELOG.md

### Release Steps
1. **Prepare release**:
   ```bash
   npm version [patch|minor|major]
   npm run build
   npm test
   ```

2. **Create release PR**:
   - Update version number
   - Update CHANGELOG.md
   - Update documentation if needed

3. **Publish to npm**:
   ```bash
   npm publish
   ```

4. **Tag release**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

## Getting Help

### Development Questions
- Check existing issues for similar problems
- Review architecture documentation
- Enable debug mode for detailed logging
- Ask questions in GitHub discussions

### Reporting Bugs
1. **Search existing issues** first
2. **Use issue template** for bug reports
3. **Include debug information**:
   - Node.js version
   - Zed version
   - Operating system
   - Debug logs
   - Minimal reproduction steps

### Feature Requests
1. **Check roadmap** for planned features
2. **Open discussion** for large features
3. **Create issue** with detailed use case
4. **Consider implementation** complexity

## Community Guidelines

### Code of Conduct
- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Maintain professional communication

### Best Practices
- **Start small**: Begin with minor bug fixes or docs
- **Ask questions**: Don't hesitate to ask for clarification
- **Be patient**: Reviews take time for quality assurance
- **Learn from feedback**: Use reviews as learning opportunities

Thank you for contributing to Claude Code ACP Agent!