import * as fs from 'fs/promises';
import * as path from 'path';
import { ACPClient, FileSystemService, Stats, PathUtils } from '../utils/types.js';
import { ErrorHandler } from '../utils/errors.js';

/**
 * Default disk-based filesystem implementation
 * Used as fallback when ACP is unavailable
 */
class DiskFileSystem implements FileSystemService {
  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      throw ErrorHandler.handle(error);
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
    } catch (error) {
      throw ErrorHandler.handle(error);
    }
  }

  async stat(filePath: string): Promise<Stats> {
    try {
      const stats = await fs.stat(filePath);
      return {
        isFile: () => stats.isFile(),
        isDirectory: () => stats.isDirectory(),
        size: stats.size,
        mtime: stats.mtime,
        mode: stats.mode
      };
    } catch (error) {
      throw ErrorHandler.handle(error);
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await this.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async readdir(dirPath: string): Promise<string[]> {
    try {
      return await fs.readdir(dirPath);
    } catch (error) {
      throw ErrorHandler.handle(error);
    }
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    try {
      await fs.mkdir(dirPath, options);
    } catch (error) {
      throw ErrorHandler.handle(error);
    }
  }
}

/**
 * ACP Filesystem Proxy
 * Provides filesystem access through ACP protocol with fallback to disk
 */
export class ACPFileSystem implements FileSystemService {
  private cache = new Map<string, { content: string; timestamp: number }>();
  private readonly CACHE_TTL = 30000; // 30 seconds cache TTL
  
  constructor(
    private client: ACPClient,
    private sessionId: string,
    private fallback: FileSystemService = new DiskFileSystem(),
    private sessionCwd?: string // Session's current working directory
  ) {}
  
  /**
   * Centralized path resolution for all filesystem operations
   * Ensures consistent path normalization using session CWD
   */
  private resolvePath(inputPath: string): string {
    return PathUtils.normalizePath(inputPath, this.sessionCwd);
  }

  async readFile(filePath: string): Promise<string> {
    // Use centralized path resolution
    const normalizedPath = this.resolvePath(filePath);
    
    // Check cache first
    const cached = this.getCachedContent(normalizedPath);
    if (cached) {
      return cached;
    }

    try {
      // Try ACP filesystem first for unsaved buffers
      const response = await this.client.readTextFile({
        sessionId: this.sessionId,
        path: normalizedPath
      });
      
      // Cache the result
      this.setCachedContent(normalizedPath, response.content);
      return response.content;
    } catch (error) {
      // Check if this is a capabilities issue
      if (this.isACPUnavailableError(error)) {
        // Fall back to disk access
        return this.fallback.readFile(normalizedPath);
      }
      
      // For other ACP errors (e.g., file not in unsaved buffers), try fallback
      try {
        const content = await this.fallback.readFile(normalizedPath);
        this.setCachedContent(normalizedPath, content);
        return content;
      } catch (fallbackError) {
        // If both ACP and disk fail, throw the original ACP error
        throw ErrorHandler.handle(error);
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const normalizedPath = this.resolvePath(filePath);
    
    try {
      // Always use ACP for writes to maintain consistency with editor
      await this.client.writeTextFile({
        sessionId: this.sessionId,
        path: normalizedPath,
        content: content
      });
      
      // Update cache
      this.setCachedContent(normalizedPath, content);
    } catch (error) {
      // If ACP write fails, check if it's a capabilities issue
      if (this.isACPUnavailableError(error)) {
        // Fall back to disk write
        await this.fallback.writeFile(normalizedPath, content);
        this.setCachedContent(normalizedPath, content);
      } else {
        throw ErrorHandler.handle(error);
      }
    }
  }

  async stat(filePath: string): Promise<Stats> {
    const normalizedPath = this.resolvePath(filePath);
    
    // Use fallback for stat operations as ACP may not provide full stat info
    return this.fallback.stat(normalizedPath);
  }

  async exists(filePath: string): Promise<boolean> {
    const normalizedPath = this.resolvePath(filePath);
    
    try {
      // First try to read through ACP (checks unsaved buffers)
      await this.client.readTextFile({
        sessionId: this.sessionId,
        path: normalizedPath
      });
      return true;
    } catch {
      // Fall back to disk check
      return this.fallback.exists(normalizedPath);
    }
  }

  async readdir(dirPath: string): Promise<string[]> {
    const normalizedPath = this.resolvePath(dirPath);
    
    // Use fallback for directory operations
    return this.fallback.readdir(normalizedPath);
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const normalizedPath = this.resolvePath(dirPath);
    
    // Use fallback for directory creation
    return this.fallback.mkdir(normalizedPath, options);
  }

  /**
   * Check ACP filesystem capabilities
   */
  async checkCapabilities(): Promise<boolean> {
    try {
      // Try a simple read operation to test ACP connectivity
      await this.client.readTextFile({
        sessionId: this.sessionId,
        path: '/dev/null' // Use a path that should safely fail
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear the file cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Dispose of the filesystem and clean up resources
   */
  dispose(): void {
    this.clearCache();
  }

  /**
   * Get cached content if valid
   */
  private getCachedContent(filePath: string): string | null {
    const cached = this.cache.get(filePath);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.content;
    }
    
    // Remove expired cache entry
    if (cached) {
      this.cache.delete(filePath);
    }
    
    return null;
  }

  /**
   * Set cached content with timestamp
   */
  private setCachedContent(filePath: string, content: string): void {
    this.cache.set(filePath, {
      content,
      timestamp: Date.now()
    });
  }


  /**
   * Check if error indicates ACP is unavailable
   */
  private isACPUnavailableError(error: unknown): boolean {
    if (error && typeof error === 'object' && error !== null && 'code' in error) {
      const errorCode = (error as { code: string | number }).code;
      // Common ACP unavailable error codes
      return errorCode === -32601 || // Method not found
             errorCode === -32603 || // Internal error
             errorCode === 'ECONNREFUSED' ||
             errorCode === 'ENOTFOUND';
    }
    return false;
  }
}

export default ACPFileSystem;