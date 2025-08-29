import { ACPFileSystem } from '../files/filesystem.js';
import { FileResolver, PathType } from '../files/resolver.js';
import { PathUtils, FileSystemService, Config } from '../utils/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';

// Mock ACP Client for testing
class MockACPClient {
  async readTextFile(params: { sessionId: string; path: string }): Promise<{ content: string }> {
    return { content: 'mock file content' };
  }
  
  async writeTextFile(params: { sessionId: string; path: string; content: string }): Promise<void> {
    // Mock implementation
  }
  
  async sessionUpdate(): Promise<void> {
    // Mock implementation
  }
  
  async requestPermission(): Promise<{ outcome: { outcome: string; optionId?: string } }> {
    return { outcome: { outcome: 'allow_once' } };
  }
}

// Mock disk filesystem
class MockDiskFileSystem implements FileSystemService {
  public files = new Map<string, string>(); // Make public for test access
  
  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }
  
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  
  async stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; size: number; mtime: Date; mode: number }> {
    if (!this.files.has(path)) {
      throw new Error(`File not found: ${path}`);
    }
    return {
      isFile: () => true,
      isDirectory: () => false,
      size: this.files.get(path)?.length || 0,
      mtime: new Date(),
      mode: 0o644
    };
  }
  
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  
  async readdir(): Promise<string[]> {
    return Array.from(this.files.keys());
  }
  
  async mkdir(): Promise<void> {
    // Mock implementation
  }
}

describe('ACPFileSystem', () => {
  let acpFileSystem: ACPFileSystem;
  let mockClient: MockACPClient;
  let mockDiskFS: MockDiskFileSystem;
  const sessionId = 'test-session';
  
  beforeEach(() => {
    mockClient = new MockACPClient();
    mockDiskFS = new MockDiskFileSystem();
    acpFileSystem = new ACPFileSystem(mockClient as unknown as import('../utils/types.js').ACPClient, sessionId, mockDiskFS);
  });
  
  describe('readFile', () => {
    it('should read from ACP client first', async () => {
      const spy = jest.spyOn(mockClient, 'readTextFile');
      
      await acpFileSystem.readFile('/test/file.txt');
      
      expect(spy).toHaveBeenCalledWith({
        sessionId,
        path: '/test/file.txt'
      });
    });
    
    it('should fallback to disk filesystem on ACP error', async () => {
      jest.spyOn(mockClient, 'readTextFile').mockRejectedValue(new Error('ACP unavailable'));
      mockDiskFS.files.set('/test/file.txt', 'disk content');
      
      const content = await acpFileSystem.readFile('/test/file.txt');
      
      expect(content).toBe('disk content');
    });
    
    it('should cache successful reads', async () => {
      const spy = jest.spyOn(mockClient, 'readTextFile');
      
      // First read
      await acpFileSystem.readFile('/test/file.txt');
      // Second read - should use cache
      await acpFileSystem.readFile('/test/file.txt');
      
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('writeFile', () => {
    it('should write through ACP client', async () => {
      const spy = jest.spyOn(mockClient, 'writeTextFile');
      
      await acpFileSystem.writeFile('/test/file.txt', 'new content');
      
      expect(spy).toHaveBeenCalledWith({
        sessionId,
        path: '/test/file.txt',
        content: 'new content'
      });
    });
    
    it('should fallback to disk on ACP write failure', async () => {
      jest.spyOn(mockClient, 'writeTextFile').mockRejectedValue({ code: -32601 }); // Method not found
      const diskSpy = jest.spyOn(mockDiskFS, 'writeFile');
      
      await acpFileSystem.writeFile('/test/file.txt', 'content');
      
      expect(diskSpy).toHaveBeenCalledWith('/test/file.txt', 'content');
    });
  });
  
  describe('cache management', () => {
    it('should clear cache when requested', async () => {
      await acpFileSystem.readFile('/test/file.txt'); // Cache the file
      
      acpFileSystem.clearCache();
      
      const spy = jest.spyOn(mockClient, 'readTextFile');
      await acpFileSystem.readFile('/test/file.txt'); // Should hit ACP again
      
      expect(spy).toHaveBeenCalled();
    });
  });
});

describe('FileResolver', () => {
  let resolver: FileResolver;
  let mockFileSystem: MockDiskFileSystem;
  let tempDir: string;
  
  const config: Config = {
    cwd: '/test/project',
    enableSmartSearch: true,
    respectGitignore: true,
    debug: false
  };
  
  beforeEach(async () => {
    mockFileSystem = new MockDiskFileSystem();
    resolver = new FileResolver(config, mockFileSystem);
    
    // Create temp directory for real file tests
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'acp-test-'));
  });
  
  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });
  
  describe('resolvePath', () => {
    it('should resolve relative paths to absolute', async () => {
      // Create a real file for testing path resolution
      const testFile = path.join(tempDir, 'test-file.txt');
      await fs.writeFile(testFile, 'test content');
      
      // Update config to use temp directory
      const tempConfig = { ...config, cwd: tempDir };
      const tempResolver = new FileResolver(tempConfig, mockFileSystem);
      
      const result = await tempResolver.resolvePath('test-file.txt');
      expect(result).toBe(testFile);
    });
    
    it('should prevent directory traversal', async () => {
      await expect(resolver.resolvePath('../../../etc/passwd'))
        .rejects.toThrow('Path outside project');
    });
    
    it('should handle cancellation', async () => {
      const controller = new AbortController();
      controller.abort();
      
      await expect(resolver.resolvePath('file.txt', controller.signal))
        .rejects.toThrow('Operation was cancelled');
    });
  });
  
  describe('findFiles', () => {
    it('should find files matching pattern', async () => {
      // Create test files
      const testFile1 = path.join(tempDir, 'test1.js');
      const testFile2 = path.join(tempDir, 'test2.js');
      await fs.writeFile(testFile1, 'content1');
      await fs.writeFile(testFile2, 'content2');
      
      // Update config to use temp directory
      const tempConfig = { ...config, cwd: tempDir };
      const tempResolver = new FileResolver(tempConfig, mockFileSystem);
      
      const results = await tempResolver.findFiles('*.js');
      
      expect(results).toHaveLength(2);
      expect(results.some(f => f.endsWith('test1.js'))).toBe(true);
      expect(results.some(f => f.endsWith('test2.js'))).toBe(true);
    });
  });
});

describe('PathUtils', () => {
  describe('normalizePath', () => {
    it('should normalize absolute paths', () => {
      const result = PathUtils.normalizePath('/test/./file/../file.txt');
      expect(result).toBe('/test/file.txt');
    });
    
    it('should convert relative paths to absolute', () => {
      const result = PathUtils.normalizePath('src/file.txt', '/project');
      expect(result).toBe('/project/src/file.txt');
    });
  });
  
  describe('isWithinRoot', () => {
    it('should allow paths within root', () => {
      const result = PathUtils.isWithinRoot('/project/src/file.txt', '/project');
      expect(result).toBe(true);
    });
    
    it('should reject paths outside root', () => {
      const result = PathUtils.isWithinRoot('/etc/passwd', '/project');
      expect(result).toBe(false);
    });
    
    it('should reject directory traversal attempts', () => {
      const result = PathUtils.isWithinRoot('/project/../etc/passwd', '/project');
      expect(result).toBe(false);
    });
  });
});
