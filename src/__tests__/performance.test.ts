import { PerformanceMonitor, MemoryManager, StreamBuffer } from '../utils/performance.js';

describe('Performance Optimizations', () => {
  describe('PerformanceMonitor', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
      monitor = new PerformanceMonitor();
    });

    it('should record request metrics correctly', () => {
      monitor.recordRequest(50, false);
      monitor.recordRequest(150, true);
      monitor.recordRequest(75, false);

      const metrics = monitor.getMetrics();
      
      expect(metrics.requestCount).toBe(3);
      expect(metrics.avgResponseTime).toBeCloseTo(91.67, 1);
      expect(metrics.errorCount).toBe(1);
      expect(metrics.errorRate).toBeCloseTo(33.33, 1);
    });

    it('should check performance targets', () => {
      // Good performance
      monitor.recordRequest(50);
      monitor.recordRequest(75);
      
      const check = monitor.checkPerformanceTargets();
      expect(check.responseTimeOk).toBe(true);
      expect(check.memoryOk).toBe(true);
      expect(check.errorRateOk).toBe(true);
    });

    it('should detect slow responses', () => {
      monitor.recordRequest(200); // Slow request
      
      const check = monitor.checkPerformanceTargets();
      expect(check.responseTimeOk).toBe(false);
    });
  });

  describe('MemoryManager', () => {
    let memoryManager: MemoryManager;

    beforeEach(() => {
      memoryManager = new MemoryManager();
    });

    it('should check memory usage', () => {
      const status = memoryManager.checkMemoryUsage();
      
      expect(status.usedMB).toBeGreaterThan(0);
      expect(status.maxMB).toBe(512);
      expect(status.percentage).toBeGreaterThanOrEqual(0);
      expect(typeof status.needsCleanup).toBe('boolean');
    });

    it('should get memory stats', () => {
      const stats = memoryManager.getMemoryStats();
      
      expect(stats.heapUsed).toBeGreaterThan(0);
      expect(stats.heapTotal).toBeGreaterThan(0);
      expect(typeof stats.gcAvailable).toBe('boolean');
    });
  });

  describe('StreamBuffer', () => {
    let buffer: StreamBuffer<string>;
    let flushedItems: string[][] = [];

    beforeEach(() => {
      flushedItems = [];
      buffer = new StreamBuffer<string>(
        3, // Small buffer for testing
        50, // Fast flush for testing
        async (items) => {
          flushedItems.push([...items]);
        }
      );
    });

    afterEach(async () => {
      await buffer.dispose();
    });

    it('should flush when buffer is full', async () => {
      await buffer.push('item1');
      await buffer.push('item2');
      await buffer.push('item3'); // Should trigger flush
      
      expect(flushedItems).toHaveLength(1);
      expect(flushedItems[0]).toEqual(['item1', 'item2', 'item3']);
    });

    it('should flush on timer', async () => {
      await buffer.push('item1');
      await buffer.push('item2');
      
      // Wait for timer flush
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(flushedItems).toHaveLength(1);
      expect(flushedItems[0]).toEqual(['item1', 'item2']);
    });

    it('should provide buffer stats', () => {
      const stats = buffer.getStats();
      
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(3);
      expect(stats.hasTimer).toBe(false);
    });

    it('should dispose cleanly', async () => {
      await buffer.push('item1');
      await buffer.dispose();
      
      expect(flushedItems).toHaveLength(1);
      expect(flushedItems[0]).toEqual(['item1']);
    });
  });

  describe('Integration Tests', () => {
    it('should maintain performance targets under load', async () => {
      const monitor = new PerformanceMonitor();
      const memoryManager = new MemoryManager();
      
      // Simulate multiple fast requests
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(new Promise(resolve => {
          setTimeout(() => {
            monitor.recordRequest(Math.random() * 50 + 25); // 25-75ms
            resolve(void 0);
          }, Math.random() * 10);
        }));
      }
      
      await Promise.all(promises);
      
      const metrics = monitor.getMetrics();
      const memoryStatus = memoryManager.checkMemoryUsage();
      const check = monitor.checkPerformanceTargets();
      
      expect(metrics.requestCount).toBe(10);
      expect(check.responseTimeOk).toBe(true);
      expect(memoryStatus.usedMB).toBeLessThan(512);
    });
  });
});