import * as path from 'path';

/**
 * Path utilities for secure file system operations
 */
export namespace PathUtils {
  /**
   * Normalize file path to absolute path using provided working directory
   */
  export function normalizePath(filePath: string, cwd = process.cwd()): string {
    if (path.isAbsolute(filePath)) {
      return path.normalize(filePath);
    }
    
    // Convert relative path to absolute using provided working directory
    return path.resolve(cwd, filePath);
  }

  /**
   * Verify path is within project boundaries to prevent directory traversal
   */
  export function isWithinRoot(filePath: string, rootPath: string): boolean {
    const normalized = path.normalize(filePath);
    const normalizedRoot = path.normalize(rootPath);
    
    return normalized.startsWith(normalizedRoot + path.sep) || normalized === normalizedRoot;
  }
  
  /**
   * Validate path against multiple allowed root directories
   */
  export function validatePath(filePath: string, allowedRoots: string[]): boolean {
    return allowedRoots.some(root => isWithinRoot(filePath, root));
  }
}