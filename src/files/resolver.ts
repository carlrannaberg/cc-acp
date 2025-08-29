import { glob } from 'glob';
import * as fs from 'fs/promises';
import * as path from 'path';
import ignore from 'ignore';
import { Config, FileSystemService, ResolvedContent, ContentBlock, PathUtils } from '../utils/types.js';
import { ErrorHandler } from '../utils/errors.js';

/**
 * Smart file resolution for ACP file operations
 * Provides intelligent file handling with fallback strategies
 */
export class FileResolver {
  constructor(
    private config: Config,
    private fileSystem: FileSystemService
  ) {}

  /**
   * Resolve content blocks containing file references
   */
  async resolvePrompt(
    content: ContentBlock[],
    signal: AbortSignal
  ): Promise<ResolvedContent[]> {
    const resolved: ResolvedContent[] = [];
    
    for (const block of content) {
      if (signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      if (block.type === 'resource_link' && block.uri.startsWith('file://')) {
        const filePath = block.uri.slice(7); // Remove file://
        
        try {
          // Try direct file access first
          const resolvedPath = await this.resolvePath(filePath, signal);
          const fileContent = await this.safeReadFile(resolvedPath);
          
          resolved.push({
            type: 'file',
            path: resolvedPath,
            content: fileContent
          });
        } catch (error) {
          const acpError = ErrorHandler.handle(error);
          
          if (acpError.code === -32001 && this.config.enableSmartSearch) {
            // File not found - fallback to glob search
            const matches = await this.globSearch(`**/*${path.basename(filePath)}*`, signal);
            
            if (matches.length > 0) {
              // Use best match (fuzzy matched)
              const bestMatch = this.selectBestMatch(filePath, matches);
              try {
                const fileContent = await this.safeReadFile(bestMatch);
                resolved.push({
                  type: 'file',
                  path: bestMatch,
                  content: fileContent
                });
              } catch (readError) {
                const readAcpError = ErrorHandler.handle(readError);
                resolved.push({
                  type: 'error',
                  message: `File found but not readable: ${bestMatch}. Error: ${readAcpError.message}`
                });
              }
            } else {
              // No matches found - provide helpful error with suggestions
              const similar = await this.suggestSimilar(filePath);
              resolved.push({
                type: 'error',
                message: `File not found: ${filePath}. Similar files: ${similar}`
              });
            }
          } else {
            // Direct error without smart search
            resolved.push({
              type: 'error',
              message: `File error: ${acpError.message}`
            });
          }
        }
      } else {
        resolved.push({ 
          type: 'content', 
          block 
        });
      }
    }
    
    return resolved;
  }

  /**
   * Resolve a file path to absolute location with validation
   * Supports AbortSignal for cancellation
   */
  async resolvePath(filePath: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    if (!filePath) {
      throw new Error('File path is required');
    }

    // Normalize to absolute path
    const normalizedPath = PathUtils.normalizePath(filePath, this.config.cwd);
    
    // Validate within project bounds (prevent directory traversal)
    if (!PathUtils.isWithinRoot(normalizedPath, this.config.cwd)) {
      throw new Error(`Path outside project: ${filePath}`);
    }
    
    if (signal?.aborted) {
      throw new Error('Operation was cancelled');
    }
    
    // Check if file/directory exists
    try {
      const stats = await fs.stat(normalizedPath);
      
      // CRITICAL FIX: If it's a directory, expand to glob pattern as required
      if (stats.isDirectory()) {
        return `${normalizedPath}/**/*`;
      }
      
      return normalizedPath;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        const acpError = ErrorHandler.createACPError(-32001, `File not found: ${filePath}`, { path: filePath });
        throw acpError;
      }
      throw ErrorHandler.handle(error);
    }
  }

  /**
   * Find files matching a pattern with smart glob search
   */
  async findFiles(pattern: string, options: FindOptions = {}): Promise<string[]> {
    try {
      const results = await this.globSearch(pattern, options.signal || new AbortController().signal);
      
      if (options.maxResults) {
        return results.slice(0, options.maxResults);
      }
      
      return results;
    } catch (error) {
      throw ErrorHandler.handle(error);
    }
  }

  /**
   * Get comprehensive file information with AbortSignal support
   */
  async getFileInfo(filePath: string, signal?: AbortSignal): Promise<FileInfo> {
    try {
      if (signal?.aborted) {
        throw new Error('Operation was cancelled');
      }
      
      const resolvedPath = await this.resolvePath(filePath, signal);
      
      if (signal?.aborted) {
        throw new Error('Operation was cancelled');
      }
      
      const stats = await fs.stat(resolvedPath);
      
      return {
        path: resolvedPath,
        originalPath: filePath,
        exists: true,
        type: this.getPathType(stats),
        size: stats.size,
        modified: stats.mtime,
        permissions: stats.mode,
        isReadable: await this.isAccessible(resolvedPath, 'read'),
        isWritable: await this.isAccessible(resolvedPath, 'write')
      };
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Operation was cancelled');
      }
      
      const acpError = ErrorHandler.handle(error);
      
      return {
        path: filePath,
        originalPath: filePath,
        exists: false,
        type: PathType.UNKNOWN,
        size: 0,
        modified: new Date(0),
        permissions: 0,
        isReadable: false,
        isWritable: false,
        error: acpError.message
      };
    }
  }

  /**
   * Check if file is accessible for specific operation
   */
  async isAccessible(filePath: string, operation: 'read' | 'write' | 'execute'): Promise<boolean> {
    try {
      const resolvedPath = await this.resolvePath(filePath);
      
      let mode: number;
      switch (operation) {
        case 'read':
          mode = fs.constants.R_OK;
          break;
        case 'write':
          mode = fs.constants.W_OK;
          break;
        case 'execute':
          mode = fs.constants.X_OK;
          break;
        default:
          return false;
      }
      
      await fs.access(resolvedPath, mode);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * CRITICAL FIX: Safe file reading with fallback to fs.promises when FileSystemService doesn't implement readFile
   */
  private async safeReadFile(filePath: string): Promise<string> {
    try {
      // Try FileSystemService first if it has readFile method
      if (this.fileSystem && typeof this.fileSystem.readFile === 'function') {
        return await this.fileSystem.readFile(filePath);
      }
    } catch (error) {
      // Fall through to fs.promises fallback
    }
    
    // Fallback to direct fs.promises access
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      throw ErrorHandler.handle(error);
    }
  }

  /**
   * Smart glob search with gitignore respect
   */
  private async globSearch(pattern: string, signal: AbortSignal): Promise<string[]> {
    if (signal.aborted) {
      throw new Error('Operation was cancelled');
    }

    try {
      interface GlobOptions {
        cwd: string;
        absolute: boolean;
        nodir: boolean;
        dot: boolean;
        ignore?: string[];
      }

      const globOptions: GlobOptions = {
        cwd: this.config.cwd,
        absolute: true,
        nodir: true, // Only return files, not directories
        dot: false   // Don't match dotfiles by default
      };

      // Add gitignore patterns if enabled
      if (this.config.respectGitignore) {
        const gitignorePatterns = await this.getGitignorePatterns();
        if (gitignorePatterns.length > 0) {
          globOptions.ignore = gitignorePatterns;
        }
      }

      const results = await glob(pattern, globOptions);
      
      // Filter results to only include files within project bounds
      return results.filter(filePath => PathUtils.isWithinRoot(filePath, this.config.cwd));
    } catch (error) {
      if (signal.aborted) {
        throw new Error('Operation was cancelled');
      }
      throw ErrorHandler.handle(error);
    }
  }

  /**
   * CRITICAL FIX: Optimized best match selection using efficient sorting instead of expensive calculations
   */
  private selectBestMatch(targetPath: string, matches: string[]): string {
    if (matches.length === 1) {
      return matches[0];
    }

    const targetName = path.basename(targetPath);
    const targetDir = path.dirname(targetPath);
    
    // Sort matches by priority criteria (most efficient approach)
    const sortedMatches = matches.sort((a, b) => {
      const aName = path.basename(a);
      const bName = path.basename(b);
      const aDir = path.dirname(a);
      const bDir = path.dirname(b);
      
      // Priority 1: Exact filename match
      if (aName === targetName && bName !== targetName) return -1;
      if (bName === targetName && aName !== targetName) return 1;
      
      // Priority 2: Directory similarity (exact match preferred)
      if (targetDir !== '.' && targetDir !== '') {
        if (aDir.includes(targetDir) && !bDir.includes(targetDir)) return -1;
        if (bDir.includes(targetDir) && !aDir.includes(targetDir)) return 1;
      }
      
      // Priority 3: Filename similarity (starts with target)
      if (aName.startsWith(targetName) && !bName.startsWith(targetName)) return -1;
      if (bName.startsWith(targetName) && !aName.startsWith(targetName)) return 1;
      
      // Priority 4: Contains target name
      if (aName.includes(targetName) && !bName.includes(targetName)) return -1;
      if (bName.includes(targetName) && !aName.includes(targetName)) return 1;
      
      // Priority 5: Shorter paths (more specific)
      return a.length - b.length;
    });

    return sortedMatches[0];
  }

  /**
   * CRITICAL FIX: More targeted search patterns to avoid broad glob vulnerabilities
   */
  private async suggestSimilar(targetPath: string): Promise<string> {
    try {
      const targetName = path.basename(targetPath);
      const targetExt = path.extname(targetName);
      const targetBase = targetName.slice(0, -targetExt.length);
      
      // Create more specific patterns to avoid overly broad searches
      const patterns = [];
      
      // Only add patterns if we have enough specificity
      if (targetBase.length >= 3) {
        patterns.push(`**/*${targetBase}*${targetExt}`); // Similar name, same ext
      }
      
      if (targetExt && targetExt.length > 1) {
        patterns.push(`**/${targetBase}*${targetExt}`); // Direct directory search
        patterns.push(`*${targetExt}`); // Same extension in current dir
      }
      
      if (targetBase.length >= 2) {
        patterns.push(`**/${targetBase.slice(0, 3)}*${targetExt}`); // Prefix match
      }
      
      // Limit pattern scope to avoid performance issues
      const suggestions = new Set<string>();
      
      for (const pattern of patterns.slice(0, 3)) { // Limit to 3 patterns
        try {
          const matches = await this.globSearch(pattern, new AbortController().signal);
          // Limit results per pattern and filter out exact target
          matches
            .filter(match => path.basename(match) !== targetName)
            .slice(0, 2)
            .forEach(match => suggestions.add(path.basename(match)));
          
          if (suggestions.size >= 4) break; // Limit total suggestions
        } catch {
          // Continue to next pattern on error
        }
      }
      
      return Array.from(suggestions).slice(0, 4).join(', ') || 'No similar files found';
    } catch {
      return 'Unable to suggest similar files';
    }
  }

  /**
   * Parse .gitignore file and return patterns
   */
  private async getGitignorePatterns(): Promise<string[]> {
    try {
      const gitignorePath = path.join(this.config.cwd, '.gitignore');
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      
      const ig = ignore().add(gitignoreContent);
      
      // Convert ignore patterns to glob-compatible patterns
      return gitignoreContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => line.startsWith('/') ? line.slice(1) : `**/${line}`)
        .concat(['node_modules/**', '.git/**']); // Always ignore these
    } catch {
      // Return default ignores if .gitignore doesn't exist
      return ['node_modules/**', '.git/**', '.DS_Store'];
    }
  }


  // REMOVED: Expensive Levenshtein distance calculations replaced with efficient sorting approach

  /**
   * Determine path type from fs.Stats
   */
  private getPathType(stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): PathType {
    if (stats.isFile()) return PathType.FILE;
    if (stats.isDirectory()) return PathType.DIRECTORY;
    if (stats.isSymbolicLink()) return PathType.SYMLINK;
    return PathType.UNKNOWN;
  }
}

// Updated interfaces
export interface ResolvedPath {
  original: string;
  absolute: string;
  normalized: string;
  exists: boolean;
}

export interface FindOptions {
  signal?: AbortSignal;
  maxResults?: number;
  respectGitignore?: boolean;
}

export interface FileInfo {
  path: string;
  originalPath: string;
  exists: boolean;
  type: PathType;
  size: number;
  modified: Date;
  permissions: number;
  isReadable: boolean;
  isWritable: boolean;
  error?: string;
}

export enum PathType {
  FILE = 'file',
  DIRECTORY = 'directory',
  SYMLINK = 'symlink',
  UNKNOWN = 'unknown'
}