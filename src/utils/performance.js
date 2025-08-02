const logger = require('../config/logger');

class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.activeTimers = new Map();
    this.thresholds = {
      database: 1000, // 1 second
      api: 2000, // 2 seconds
      socket: 500, // 500ms
      game: 100 // 100ms for game operations
    };
  }

  // Start timing an operation
  startTimer(operationId, category = 'general') {
    const startTime = process.hrtime.bigint();
    this.activeTimers.set(operationId, {
      startTime,
      category,
      timestamp: Date.now()
    });
  }

  // End timing and record metric
  endTimer(operationId, metadata = {}) {
    const timer = this.activeTimers.get(operationId);
    if (!timer) {
      logger.warn(`Performance timer not found: ${operationId}`);
      return null;
    }

    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - timer.startTime) / 1000000; // Convert to milliseconds
    
    this.activeTimers.delete(operationId);

    const metric = {
      operationId,
      category: timer.category,
      duration,
      timestamp: timer.timestamp,
      metadata
    };

    // Store metric
    if (!this.metrics.has(timer.category)) {
      this.metrics.set(timer.category, []);
    }
    
    const categoryMetrics = this.metrics.get(timer.category);
    categoryMetrics.push(metric);

    // Keep only last 1000 metrics per category
    if (categoryMetrics.length > 1000) {
      categoryMetrics.shift();
    }

    // Check if duration exceeds threshold
    const threshold = this.thresholds[timer.category] || 5000;
    if (duration > threshold) {
      logger.warn(`Slow operation detected: ${operationId} took ${duration.toFixed(2)}ms (threshold: ${threshold}ms)`, {
        category: timer.category,
        duration,
        metadata
      });
    }

    logger.debug(`Performance: ${operationId} completed in ${duration.toFixed(2)}ms`);
    return metric;
  }

  // Get performance statistics
  getStats(category = null) {
    const stats = {};

    const categories = category ? [category] : Array.from(this.metrics.keys());

    for (const cat of categories) {
      const metrics = this.metrics.get(cat) || [];
      if (metrics.length === 0) {
        stats[cat] = { count: 0 };
        continue;
      }

      const durations = metrics.map(m => m.duration);
      const sorted = durations.sort((a, b) => a - b);

      stats[cat] = {
        count: metrics.length,
        avg: durations.reduce((a, b) => a + b, 0) / durations.length,
        min: Math.min(...durations),
        max: Math.max(...durations),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
        threshold: this.thresholds[cat] || 5000,
        violations: durations.filter(d => d > (this.thresholds[cat] || 5000)).length
      };
    }

    return stats;
  }

  // Clear old metrics
  cleanup() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    for (const [category, metrics] of this.metrics.entries()) {
      const filtered = metrics.filter(m => m.timestamp > oneHourAgo);
      this.metrics.set(category, filtered);
    }

    // Clean up stale timers (older than 10 minutes)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    for (const [operationId, timer] of this.activeTimers.entries()) {
      if (timer.timestamp < tenMinutesAgo) {
        logger.warn(`Removing stale performance timer: ${operationId}`);
        this.activeTimers.delete(operationId);
      }
    }
  }

  // Middleware for Express routes
  expressMiddleware() {
    return (req, res, next) => {
      const operationId = `${req.method}_${req.path}_${Date.now()}`;
      this.startTimer(operationId, 'api');

      // Override res.end to capture response time
      const originalEnd = res.end;
      res.end = (...args) => {
        this.endTimer(operationId, {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          userAgent: req.get('User-Agent'),
          ip: req.ip
        });
        originalEnd.apply(res, args);
      };

      next();
    };
  }

  // Database operation wrapper
  async wrapDatabaseOperation(operationName, operation) {
    const operationId = `db_${operationName}_${Date.now()}`;
    this.startTimer(operationId, 'database');

    try {
      const result = await operation();
      this.endTimer(operationId, { operationName, success: true });
      return result;
    } catch (error) {
      this.endTimer(operationId, { operationName, success: false, error: error.message });
      throw error;
    }
  }

  // Socket operation wrapper
  wrapSocketOperation(operationName, operation) {
    const operationId = `socket_${operationName}_${Date.now()}`;
    this.startTimer(operationId, 'socket');

    try {
      const result = operation();
      this.endTimer(operationId, { operationName, success: true });
      return result;
    } catch (error) {
      this.endTimer(operationId, { operationName, success: false, error: error.message });
      throw error;
    }
  }

  // Game operation wrapper
  async wrapGameOperation(operationName, operation) {
    const operationId = `game_${operationName}_${Date.now()}`;
    this.startTimer(operationId, 'game');

    try {
      const result = await operation();
      this.endTimer(operationId, { operationName, success: true });
      return result;
    } catch (error) {
      this.endTimer(operationId, { operationName, success: false, error: error.message });
      throw error;
    }
  }

  // Get system performance metrics
  getSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024) // MB
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: process.uptime(),
      activeTimers: this.activeTimers.size,
      totalMetrics: Array.from(this.metrics.values()).reduce((sum, arr) => sum + arr.length, 0)
    };
  }
}

// Create singleton instance
const performanceMonitor = new PerformanceMonitor();

// Cleanup every 30 minutes
setInterval(() => {
  performanceMonitor.cleanup();
}, 30 * 60 * 1000);

module.exports = performanceMonitor;