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
  model?: string;
  fallbackModel?: string;
  customSystemPrompt?: string;
  appendSystemPrompt?: string;
  addDirs?: string[];
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  permissionPromptTool?: string;
  executable?: 'node' | 'bun' | 'deno';
  execArgs?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  strictMcpConfig?: boolean;
  maxTurns?: number;
  extraArgs?: Record<string, string | null>;
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
  const addDirs: string[] = [];
  const execArgs: string[] = [];
  const extraArgs: Record<string, string | null> = {};
  
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
      case '--model':
        options.model = argv[++i];
        break;
      case '--fallback-model':
        options.fallbackModel = argv[++i];
        break;
      case '--custom-system-prompt':
        options.customSystemPrompt = argv[++i];
        break;
      case '--append-system-prompt':
        options.appendSystemPrompt = argv[++i];
        break;
      case '--add-dir':
        addDirs.push(argv[++i]);
        break;
      case '--permission-mode':
        options.permissionMode = argv[++i] as CLIOptions['permissionMode'];
        break;
      case '--permission-prompt-tool':
        options.permissionPromptTool = argv[++i];
        break;
      case '--executable':
        options.executable = argv[++i] as CLIOptions['executable'];
        break;
      case '--exec-arg':
        execArgs.push(argv[++i]);
        break;
      case '--allowed-tools':
        options.allowedTools = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '--disallowed-tools':
        options.disallowedTools = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '--strict-mcp-config':
        options.strictMcpConfig = true;
        break;
      case '--max-turns': {
        const v = parseInt(argv[++i]);
        if (!Number.isFinite(v) || v <= 0) {
          console.error('Error: --max-turns must be a positive integer');
          process.exit(1);
        }
        options.maxTurns = v;
        break;
      }
      case '--extra-arg': {
        const kv = argv[++i];
        const eq = kv.indexOf('=');
        if (eq === -1) {
          extraArgs[kv] = null;
        } else {
          const k = kv.slice(0, eq);
          const v = kv.slice(eq + 1);
          extraArgs[k] = v === '' ? null : v;
        }
        break;
      }
      default:
        if (arg.startsWith('-')) {
          console.error(`Error: Unknown option ${arg}`);
          showHelp();
          process.exit(1);
        }
        break;
    }
  }
  if (addDirs.length > 0) options.addDirs = addDirs;
  if (execArgs.length > 0) options.execArgs = execArgs;
  if (Object.keys(extraArgs).length > 0) options.extraArgs = extraArgs;
  
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
  --model <name>                    Set Claude model for SDK
  --fallback-model <name>           Set fallback model
  --custom-system-prompt <text>     Override system prompt
  --append-system-prompt <text>     Append to system prompt
  --add-dir <path>                  Add project directory (repeatable)
  --permission-mode <mode>          default|acceptEdits|bypassPermissions|plan
  --permission-prompt-tool <name>   Use SDK permission prompt tool
  --executable <node|bun|deno>      Runtime for SDK CLI
  --exec-arg <arg>                  Additional executable arg (repeatable)
  --allowed-tools <a,b,c>           Allow-list tools (comma-separated)
  --disallowed-tools <a,b,c>        Block-list tools (comma-separated)
  --strict-mcp-config               Enforce SDK MCP config strictly
  --max-turns <n>                   Set max internal turns (CLAUDE_MAX_TURNS)
  --extra-arg key=value             Extra arg passed to SDK (repeatable)

Environment Variables:
  DEBUG              Enable debug logging
  CLAUDE_API_KEY     API key for Claude SDK (optional if using Claude Code subscription)
  ACP_LOG_LEVEL      Logging verbosity (error/warn/info/debug)
  ACP_TIMEOUT        Session timeout in milliseconds

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
  
  // Map CLI options to environment for agent configuration
  if (options.model) process.env.CLAUDE_MODEL = options.model;
  if (options.fallbackModel) process.env.CLAUDE_FALLBACK_MODEL = options.fallbackModel;
  if (options.customSystemPrompt) process.env.CLAUDE_CUSTOM_SYSTEM_PROMPT = options.customSystemPrompt;
  if (options.appendSystemPrompt) process.env.CLAUDE_APPEND_SYSTEM_PROMPT = options.appendSystemPrompt;
  if (options.addDirs && options.addDirs.length > 0) process.env.CLAUDE_ADDITIONAL_DIRS = options.addDirs.join(',');
  if (options.permissionMode) process.env.CLAUDE_PERMISSION_MODE = options.permissionMode;
  if (options.permissionPromptTool) process.env.CLAUDE_PERMISSION_PROMPT_TOOL = options.permissionPromptTool;
  if (options.executable) process.env.CLAUDE_EXECUTABLE = options.executable;
  if (options.execArgs && options.execArgs.length > 0) process.env.CLAUDE_EXEC_ARGS = options.execArgs.join(',');
  if (options.allowedTools) process.env.CLAUDE_ALLOWED_TOOLS = options.allowedTools.join(',');
  if (options.disallowedTools) process.env.CLAUDE_DISALLOWED_TOOLS = options.disallowedTools.join(',');
  if (options.strictMcpConfig) process.env.CLAUDE_STRICT_MCP_CONFIG = 'true';
  if (options.maxTurns) process.env.CLAUDE_MAX_TURNS = String(options.maxTurns);
  if (options.extraArgs && Object.keys(options.extraArgs).length > 0) process.env.CLAUDE_EXTRA_ARGS = JSON.stringify(options.extraArgs);

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
