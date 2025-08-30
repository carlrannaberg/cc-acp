#!/usr/bin/env node

import { ClaudeACPAgent } from './bridge/agent.js';

// Version information - read from package.json
import * as fs from 'fs';
import * as path from 'path';

function getVersion(): string {
  try {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    const packageData = JSON.parse(packageContent);
    return packageData.version;
  } catch {
    return '1.0.0'; // fallback version
  }
}

const VERSION = getVersion();

interface CLIOptions {
  debug?: boolean;
  config?: string;
  version?: boolean;
  help?: boolean;
}

// Validate environment variables
function validateEnvironment(): void {
  // Validate ACP_TIMEOUT if set
  if (process.env.ACP_TIMEOUT) {
    const timeout = parseInt(process.env.ACP_TIMEOUT);
    if (isNaN(timeout) || timeout < 0) {
      console.error('Error: ACP_TIMEOUT must be a positive number');
      process.exit(1);
    }
  }
  
  // Validate ACP_LOG_LEVEL if set
  if (process.env.ACP_LOG_LEVEL) {
    const validLevels = ['error', 'warn', 'info', 'debug'];
    if (!validLevels.includes(process.env.ACP_LOG_LEVEL)) {
      console.error(`Error: ACP_LOG_LEVEL must be one of: ${validLevels.join(', ')}`);
      process.exit(1);
    }
  }
}

// Parse command-line arguments
function parseArgs(argv: string[]): CLIOptions {
  const options: CLIOptions = {};
  
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--version':
        options.version = true;
        break;
      case '--help':
        options.help = true;
        break;
      case '--debug':
        options.debug = true;
        break;
      case '--config':
        if (i + 1 < argv.length) {
          options.config = argv[++i];
        } else {
          console.error('Error: --config requires a path argument');
          process.exit(1);
        }
        break;
      // No SDK passthrough flags; prefer environment variables.
      default:
        if (arg.startsWith('-')) {
          console.error(`Error: Unknown option ${arg}`);
          showHelp();
          process.exit(1);
        }
        break;
    }
  }
  
  return options;
}

// Show version information
function showVersion(): void {
  console.log(`claude-code-acp version ${VERSION}`);
}

// Show help text
function showHelp(): void {
  console.log(`
Claude Code ACP Agent

Usage: claude-code-acp [options]

Options:
  --version     Show version information
  --help        Show this help message
  --debug       Enable debug mode
  --config      Path to configuration file

Environment Variables (preferred):
  DEBUG                       Enable debug logging
  CLAUDE_API_KEY              API key for Claude SDK (optional if using Claude Code subscription)
  ACP_LOG_LEVEL               Logging verbosity (error|warn|info|debug)
  ACP_TIMEOUT                 Session timeout in milliseconds
  CLAUDE_MODEL                Preferred Claude model
  CLAUDE_FALLBACK_MODEL       Fallback model
  CLAUDE_CUSTOM_SYSTEM_PROMPT Replace SDK system prompt
  CLAUDE_APPEND_SYSTEM_PROMPT Append to system prompt
  CLAUDE_ADDITIONAL_DIRS      Comma-separated directories to add
  CLAUDE_PERMISSION_MODE      default|acceptEdits|bypassPermissions|plan
  CLAUDE_PERMISSION_PROMPT_TOOL Permission prompt tool name
  CLAUDE_EXECUTABLE           node|bun|deno
  CLAUDE_EXEC_ARGS            Comma-separated runtime args
  CLAUDE_ALLOWED_TOOLS        Comma-separated tool allowlist
  CLAUDE_DISALLOWED_TOOLS     Comma-separated tool blocklist
  CLAUDE_STRICT_MCP_CONFIG    true to enforce strict MCP config
  CLAUDE_EXTRA_ARGS           JSON map of extra flags for SDK
  CLAUDE_MAX_TURNS            Optional limit for internal reasoning turns

For more information, visit: https://github.com/carlrannaberg/cc-acp`);
}

// Main entry point
async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  
  // Handle version flag
  if (options.version) {
    showVersion();
    return;
  }
  
  // Handle help flag
  if (options.help) {
    showHelp();
    return;
  }
  
  // Validate environment before starting
  validateEnvironment();

  // Set debug mode from command line or environment
  if (options.debug || process.env.DEBUG) {
    process.env.ACP_LOG_LEVEL = 'debug';
  }
  
  try {
    const agent = new ClaudeACPAgent();
    
    // Handle graceful shutdown
    const cleanup = async () => {
      console.error('Shutting down gracefully...');
      try {
        await agent.stop();
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
      process.exit(0);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    
    if (process.env.ACP_LOG_LEVEL === 'debug') {
      console.error('Claude Code ACP Agent starting in debug mode...');
    } else {
      console.error('Claude Code ACP Agent starting...');
    }
    
    // Actually start the agent (this was missing before!)
    await agent.start();
    
    // The agent should now be listening on stdin/stdout for ACP protocol messages
    // Keep the process alive to handle incoming requests
    process.stdin.resume();
    
  } catch (error) {
    console.error('Failed to start Claude Code ACP Agent:', error);
    process.exit(1);
  }
}

// Only run if this is the main module
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

// Export for use as a library
export * from './bridge/agent.js';
export * from './protocol/connection.js';
export * from './protocol/schemas.js';
