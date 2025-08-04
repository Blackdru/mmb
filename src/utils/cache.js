const logger = require('../config/logger');

class MemoryCache {
  constructor() {
    this.cache = new Map();
    this.ttlMap = new Map();
    this.maxSize = 1000; // Maximum number of cached items
    
    // Cleanup expired items every 5 minutes
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  set(key, value, ttlSeconds = 300) { // Default 5 minutes TTL
    try {
      // Remove oldest items if cache is full
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        this.delete(firstKey);
      }

      const expiresAt = Date.now() + (ttlSeconds * 1000);
      this.cache.set(key, value);
      this.ttlMap.set(key, expiresAt);
      
      logger.debug(`Cache SET: ${key} (TTL: ${ttlSeconds}s)`);
    } catch (error) {
      logger.error('Cache SET error:', error);
    }
  }

  get(key) {
    try {
      if (!this.cache.has(key)) {
        return null;
      }

      const expiresAt = this.ttlMap.get(key);
      if (expiresAt && Date.now() > expiresAt) {
        this.delete(key);
        return null;
      }

      const value = this.cache.get(key);
      logger.debug(`Cache HIT: ${key}`);
      return value;
    } catch (error) {
      logger.error('Cache GET error:', error);
      return null;
    }
  }

  delete(key) {
    try {
      this.cache.delete(key);
      this.ttlMap.delete(key);
      logger.debug(`Cache DELETE: ${key}`);
    } catch (error) {
      logger.error('Cache DELETE error:', error);
    }
  }

  clear() {
    try {
      this.cache.clear();
      this.ttlMap.clear();
      logger.info('Cache cleared');
    } catch (error) {
      logger.error('Cache CLEAR error:', error);
    }
  }

  cleanup() {
    try {
      const now = Date.now();
      let expiredCount = 0;

      for (const [key, expiresAt] of this.ttlMap.entries()) {
        if (now > expiresAt) {
          this.delete(key);
          expiredCount++;
        }
      }

      if (expiredCount > 0) {
        logger.debug(`Cache cleanup: removed ${expiredCount} expired items`);
      }
    } catch (error) {
      logger.error('Cache cleanup error:', error);
    }
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      memoryUsage: process.memoryUsage().heapUsed
    };
  }

  // Utility methods for common cache patterns
  async getOrSet(key, fetchFunction, ttlSeconds = 300) {
    try {
      let value = this.get(key);
      
      if (value === null) {
        value = await fetchFunction();
        if (value !== null && value !== undefined) {
          this.set(key, value, ttlSeconds);
        }
      }
      
      return value;
    } catch (error) {
      logger.error('Cache getOrSet error:', error);
      // Fallback to direct fetch if cache fails
      return await fetchFunction();
    }
  }
}

// Create singleton instance
const cache = new MemoryCache();

module.exports = cache;