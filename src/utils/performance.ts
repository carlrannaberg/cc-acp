import { LRUCache } from 'lru-cache';

/**
 * Performance monitoring and optimization utilities
 */
export class PerformanceMonitor {
  private startTime = Date.now();
  private metrics = {
    requestCount: 0,
    totalResponseTime: 0,
    errorCount: 0,
    memoryAlerts: 0
  };

  /**
   * Record request performance
   */
  recordRequest(responseTime: number, isError = false): void {
    this.metrics.requestCount++;
    this.metrics.totalResponseTime += responseTime;
    
    if (isError) {
      this.metrics.errorCount++;
    }
  }

  /**
   * Get performance summary
   */
  getMetrics(): PerformanceMetrics {
    const uptime = Date.now() - this.startTime;
    const avgResponseTime = this.metrics.requestCount > 0 
      ? this.metrics.totalResponseTime / this.metrics.requestCount 
      : 0;
    
    const memoryUsage = process.memoryUsage();
    
    return {
      uptime,
      requestCount: this.metrics.requestCount,
      avgResponseTime,
      errorCount: this.metrics.errorCount,
      errorRate: this.metrics.requestCount > 0 ? (this.metrics.errorCount / this.metrics.requestCount) * 100 : 0,
      memoryUsedMB: memoryUsage.heapUsed / (1024 * 1024),
      memoryAlerts: this.metrics.memoryAlerts
    };
  }

  /**
   * Check if performance targets are met
   */
  checkPerformanceTargets(): PerformanceCheck {
    const metrics = this.getMetrics();
    
    return {
      responseTimeOk: metrics.avgResponseTime < 100, // <100ms target
      memoryOk: metrics.memoryUsedMB < 512, // <512MB target
      errorRateOk: metrics.errorRate < 5 // <5% error rate
    };
  }

  /**
   * Trigger memory alert
   */
  recordMemoryAlert(): void {
    this.metrics.memoryAlerts++;
  }
}

/**
 * Memory management utilities
 */
export class MemoryManager {
  private readonly MAX_MEMORY_MB = 512;
  private lastGCTime = 0;
  private readonly GC_COOLDOWN = 30000; // 30 seconds

  /**
   * Check memory usage and trigger cleanup if needed
   */
  checkMemoryUsage(): MemoryStatus {
    const usage = process.memoryUsage();
    const usedMB = usage.heapUsed / (1024 * 1024);
    
    const status: MemoryStatus = {
      usedMB,
      maxMB: this.MAX_MEMORY_MB,
      percentage: (usedMB / this.MAX_MEMORY_MB) * 100,
      needsCleanup: usedMB > this.MAX_MEMORY_MB * 0.8 // Cleanup at 80%
    };

    if (status.needsCleanup) {
      this.triggerGarbageCollection();
    }

    return status;
  }

  /**
   * Force garbage collection with cooldown
   */
  private triggerGarbageCollection(): boolean {
    const now = Date.now();
    if (now - this.lastGCTime < this.GC_COOLDOWN) {
      return false; // Still in cooldown
    }

    if (global.gc) {
      global.gc();
      this.lastGCTime = now;
      return true;
    }
    
    return false;
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): NodeJS.MemoryUsage & { gcAvailable: boolean } {
    return {
      ...process.memoryUsage(),
      gcAvailable: typeof global.gc === 'function'
    };
  }
}

/**
 * Stream backpressure management
 */
export class StreamBuffer<T> {
  private buffer: T[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly bufferSize: number;
  private readonly flushInterval: number;
  private readonly flushCallback: (items: T[]) => Promise<void>;

  constructor(
    bufferSize = 100,
    flushInterval = 100, // ms
    flushCallback: (items: T[]) => Promise<void>
  ) {
    this.bufferSize = bufferSize;
    this.flushInterval = flushInterval;
    this.flushCallback = flushCallback;
  }

  /**
   * Add item to buffer
   */
  async push(item: T): Promise<void> {
    this.buffer.push(item);
    
    if (this.buffer.length >= this.bufferSize) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  /**
   * Force flush all buffered items
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    const items = this.buffer.splice(0);
    if (items.length === 0) return;
    
    try {
      await this.flushCallback(items);
    } catch (error) {
      console.error('Error flushing stream buffer:', error);
      // Re-add items to buffer for retry
      this.buffer.unshift(...items);
      throw error;
    }
  }

  /**
   * Get buffer statistics
   */
  getStats(): { size: number; maxSize: number; hasTimer: boolean } {
    return {
      size: this.buffer.length,
      maxSize: this.bufferSize,
      hasTimer: this.flushTimer !== null
    };
  }

  /**
   * Dispose of buffer and cleanup
   */
  async dispose(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    // Final flush
    if (this.buffer.length > 0) {
      await this.flush();
    }
  }
}

/**
 * Rate limiter for API calls
 */
export class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 100, windowMs = 60000) { // 100 requests per minute
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if request is allowed under rate limit
   */
  isAllowed(): boolean {
    const now = Date.now();
    
    // Remove old requests outside the window
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      return false;
    }
    
    this.requests.push(now);
    return true;
  }

  /**
   * Get time until next request is allowed
   */
  getTimeUntilReset(): number {
    if (this.requests.length < this.maxRequests) {
      return 0;
    }
    
    const oldestRequest = Math.min(...this.requests);
    return Math.max(0, this.windowMs - (Date.now() - oldestRequest));
  }
}

/**
 * Performance metrics interface
 */
export interface PerformanceMetrics {
  uptime: number;
  requestCount: number;
  avgResponseTime: number;
  errorCount: number;
  errorRate: number;
  memoryUsedMB: number;
  memoryAlerts: number;
}

/**
 * Performance check results
 */
export interface PerformanceCheck {
  responseTimeOk: boolean;
  memoryOk: boolean;
  errorRateOk: boolean;
}

/**
 * Memory status information
 */
export interface MemoryStatus {
  usedMB: number;
  maxMB: number;
  percentage: number;
  needsCleanup: boolean;
}

/**
 * Global performance monitor instance
 */
export const globalPerformanceMonitor = new PerformanceMonitor();

/**
 * Global memory manager instance
 */
export const globalMemoryManager = new MemoryManager();