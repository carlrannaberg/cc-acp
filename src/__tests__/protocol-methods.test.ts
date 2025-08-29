// Mock the Claude SDK before importing the agent
jest.mock('@anthropic-ai/claude-code', () => ({
  query: jest.fn().mockImplementation(() => ({
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Mock response' }] } };
    }
  }))
}));

import { ClaudeACPAgent } from '../bridge/agent.js';
import { Readable, Writable, PassThrough } from 'stream';
import type { SessionManager } from '../bridge/session.js';

// Test interface to access private methods for testing
interface TestableClaudeACPAgent {
  handleMethod(method: string, params?: unknown): Promise<unknown>;
  config: { debug: boolean; [key: string]: unknown };
  sessionManager: SessionManager;
  stop(): Promise<void>;
  readTextFile(params: { sessionId: string; path: string; line?: number | null; limit?: number | null }): Promise<{ content: string }>;
  writeTextFile(params: { sessionId: string; path: string; content: string }): Promise<void>;
  requestPermission(params: { sessionId: string; toolCall: unknown; options: unknown[] }): Promise<{ outcome: { outcome: string; optionId?: string } }>;
}

describe('ACP Protocol Methods', () => {
  let agent: ClaudeACPAgent;
  let testAgent: TestableClaudeACPAgent;
  let inputStream: PassThrough;
  let outputStream: PassThrough;
  let outputData: string[] = [];
  let originalEnv: string | undefined;

  beforeAll(() => {
    // Save original API key and set test key
    originalEnv = process.env.CLAUDE_API_KEY;
    process.env.CLAUDE_API_KEY = 'test-api-key';
  });

  afterAll(() => {
    // Restore original API key
    if (originalEnv !== undefined) {
      process.env.CLAUDE_API_KEY = originalEnv;
    } else {
      delete process.env.CLAUDE_API_KEY;
    }
  });

  beforeEach(() => {
    inputStream = new PassThrough();
    outputStream = new PassThrough();
    outputData = [];
    
    outputStream.on('data', (chunk) => {
      outputData.push(chunk.toString());
    });

    agent = new ClaudeACPAgent(
      inputStream as unknown as Readable,
      outputStream as unknown as Writable
    );
    testAgent = agent as unknown as TestableClaudeACPAgent;
  });

  afterEach(async () => {
    await agent.stop();
  });

  describe('Protocol Method Names', () => {
    it('should handle session/new method', async () => {
      const mockHandleMethod = jest.spyOn(testAgent, 'handleMethod');
      
      // Initialize first
      await testAgent.handleMethod('initialize', { 
        protocolVersion: 1 
      });
      
      // Test session/new
      const result = await testAgent.handleMethod('session/new', {
        cwd: '/test',
        mcpServers: []
      });
      
      expect(result).toHaveProperty('sessionId');
      expect(mockHandleMethod).toHaveBeenCalledWith('session/new', expect.any(Object));
    });

    it('should handle session/load method', async () => {
      // Initialize and create session first
      await testAgent.handleMethod('initialize', { 
        protocolVersion: 1 
      });
      
      const newSessionResult = await testAgent.handleMethod('session/new', {
        cwd: '/test',
        mcpServers: []
      }) as { sessionId: string };
      
      // Test session/load
      const result = await testAgent.handleMethod('session/load', {
        sessionId: newSessionResult.sessionId,
        cwd: '/new-test',
        mcpServers: []
      });
      
      expect(result).toBeNull(); // LoadSessionResponse is null
    });

    it('should handle session/cancel notification', async () => {
      // Initialize and create session first
      await testAgent.handleMethod('initialize', { 
        protocolVersion: 1 
      });
      
      const newSessionResult = await testAgent.handleMethod('session/new', {
        cwd: '/test',
        mcpServers: []
      }) as { sessionId: string };
      
      // Test session/cancel
      const result = await testAgent.handleMethod('session/cancel', {
        sessionId: newSessionResult.sessionId
      });
      
      expect(result).toBeNull(); // Notifications return null
    });

    it('should handle fs/read_text_file method', async () => {
      const mockReadTextFile = jest.spyOn(agent, 'readTextFile');
      mockReadTextFile.mockResolvedValue({ content: 'test content' });
      
      // Initialize with capabilities
      await testAgent.handleMethod('initialize', { 
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            readTextFile: true
          }
        }
      });
      
      const newSessionResult = await testAgent.handleMethod('session/new', {
        cwd: '/test',
        mcpServers: []
      }) as { sessionId: string };
      
      // Test fs/read_text_file
      const result = await testAgent.handleMethod('fs/read_text_file', {
        sessionId: newSessionResult.sessionId,
        path: '/test/file.txt'
      });
      
      expect(mockReadTextFile).toHaveBeenCalled();
    });

    it('should handle fs/write_text_file method', async () => {
      const mockWriteTextFile = jest.spyOn(agent, 'writeTextFile');
      mockWriteTextFile.mockResolvedValue();
      
      // Initialize with capabilities
      await testAgent.handleMethod('initialize', { 
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            writeTextFile: true
          }
        }
      });
      
      const newSessionResult = await testAgent.handleMethod('session/new', {
        cwd: '/test',
        mcpServers: []
      }) as { sessionId: string };
      
      // Test fs/write_text_file
      const result = await testAgent.handleMethod('fs/write_text_file', {
        sessionId: newSessionResult.sessionId,
        path: '/test/file.txt',
        content: 'test content'
      });
      
      expect(result).toBeNull();
      expect(mockWriteTextFile).toHaveBeenCalled();
    });

    it('should handle session/request_permission method', async () => {
      const mockRequestPermission = jest.spyOn(agent, 'requestPermission');
      mockRequestPermission.mockResolvedValue({
        outcome: { outcome: 'allow_once', optionId: 'opt1' }
      });
      
      await testAgent.handleMethod('initialize', { 
        protocolVersion: 1 
      });
      
      const newSessionResult = await testAgent.handleMethod('session/new', {
        cwd: '/test',
        mcpServers: []
      }) as { sessionId: string };
      
      // Test session/request_permission
      const result = await testAgent.handleMethod('session/request_permission', {
        sessionId: newSessionResult.sessionId,
        toolCall: {
          toolCallId: 'test-id',
          title: 'Test Tool',
          status: 'in_progress',
          kind: 'read'
        },
        options: [
          { optionId: 'opt1', name: 'Allow', kind: 'allow_once' }
        ]
      });
      
      expect(mockRequestPermission).toHaveBeenCalled();
    });

    it('should reject unknown methods', async () => {
      await testAgent.handleMethod('initialize', { 
        protocolVersion: 1 
      });
      
      await expect(testAgent.handleMethod('unknown/method', {}))
        .rejects.toMatchObject({
          code: -32601,
          message: expect.stringContaining('not found')
        });
    });
  });

  describe('Client Capabilities', () => {
    it('should use fallback when fs read capability is disabled', async () => {
      const mockReadFile = jest.spyOn(agent['diskFileSystem'], 'readFile');
      mockReadFile.mockResolvedValue('fallback content');
      
      // Initialize without fs capabilities
      await testAgent.handleMethod('initialize', { 
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            readTextFile: false
          }
        }
      });
      
      const newSessionResult = await testAgent.handleMethod('session/new', {
        cwd: '/test',
        mcpServers: []
      }) as { sessionId: string };
      
      // Should use fallback filesystem when capability is disabled
      const result = await agent.readTextFile({
        sessionId: newSessionResult.sessionId,
        path: '/test/file.txt'
      });
      
      expect(result.content).toBe('fallback content');
      expect(mockReadFile).toHaveBeenCalledWith('/test/file.txt');
    });

    it('should use fallback when fs write capability is disabled', async () => {
      const mockWriteFile = jest.spyOn(agent['diskFileSystem'], 'writeFile');
      mockWriteFile.mockResolvedValue();
      
      // Initialize without fs capabilities
      await testAgent.handleMethod('initialize', { 
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            writeTextFile: false
          }
        }
      });
      
      const newSessionResult = await testAgent.handleMethod('session/new', {
        cwd: '/test',
        mcpServers: []
      }) as { sessionId: string };
      
      // Should use fallback filesystem when capability is disabled
      await agent.writeTextFile({
        sessionId: newSessionResult.sessionId,
        path: '/test/file.txt',
        content: 'test content'
      });
      
      expect(mockWriteFile).toHaveBeenCalledWith('/test/file.txt', 'test content');
    });

    it('should allow operations when capabilities are not specified', async () => {
      const mockReadTextFile = jest.spyOn(agent, 'readTextFile');
      mockReadTextFile.mockResolvedValue({ content: 'test' });
      
      // Initialize without specifying capabilities (defaults to allowed)
      await testAgent.handleMethod('initialize', { 
        protocolVersion: 1
      });
      
      const newSessionResult = await testAgent.handleMethod('session/new', {
        cwd: '/test',
        mcpServers: []
      }) as { sessionId: string };
      
      // Should work when capability is not specified
      await testAgent.handleMethod('fs/read_text_file', {
        sessionId: newSessionResult.sessionId,
        path: '/test/file.txt'
      });
      
      expect(mockReadTextFile).toHaveBeenCalled();
    });
  });

  describe('MCP Servers', () => {
    it('should reject mcpServers in session creation', async () => {
      await testAgent.handleMethod('initialize', { 
        protocolVersion: 1 
      });
      
      const mcpServers = [
        { name: 'test-server', command: 'test', args: [], env: [] }
      ];
      
      // Should throw when MCP servers are provided
      await expect(testAgent.handleMethod('session/new', {
        cwd: '/test',
        mcpServers
      })).rejects.toMatchObject({
        message: expect.stringContaining('MCP servers not implemented')
      });
    });

    it('should reject mcpServers in session load', async () => {
      await testAgent.handleMethod('initialize', { 
        protocolVersion: 1 
      });
      
      const newSessionResult = await testAgent.handleMethod('session/new', {
        cwd: '/test',
        mcpServers: []
      }) as { sessionId: string };
      
      const newMcpServers = [
        { name: 'updated-server', command: 'test', args: [], env: [] }
      ];
      
      // Should throw when MCP servers are provided
      await expect(testAgent.handleMethod('session/load', {
        sessionId: newSessionResult.sessionId,
        cwd: '/new-test',
        mcpServers: newMcpServers
      })).rejects.toMatchObject({
        message: expect.stringContaining('MCP servers not implemented')
      });
    });
  });
});