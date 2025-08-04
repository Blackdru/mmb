const prisma = require('../config/database');
const logger = require('../config/logger');

class DatabaseHealthCheck {
  constructor() {
    this.isHealthy = true;
    this.lastHealthCheck = Date.now();
    this.healthCheckInterval = 30000; // 30 seconds
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
  }

  async checkHealth() {
    try {
      await prisma.$queryRaw`SELECT 1`;
      this.isHealthy = true;
      this.lastHealthCheck = Date.now();
      this.reconnectAttempts = 0;
      return true;
    } catch (error) {
      logger.error('Database health check failed:', error.message);
      this.isHealthy = false;
      
      // Attempt reconnection
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        logger.info(`Attempting database reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        try {
          await prisma.$disconnect();
          await prisma.$connect();
          logger.info('Database reconnection successful');
          this.isHealthy = true;
          this.reconnectAttempts = 0;
          return true;
        } catch (reconnectError) {
          logger.error(`Database reconnection attempt ${this.reconnectAttempts} failed:`, reconnectError.message);
        }
      }
      
      return false;
    }
  }

  async ensureConnection() {
    const now = Date.now();
    
    // Check if we need to perform a health check
    if (now - this.lastHealthCheck > this.healthCheckInterval || !this.isHealthy) {
      return await this.checkHealth();
    }
    
    return this.isHealthy;
  }

  startPeriodicHealthCheck() {
    setInterval(async () => {
      await this.checkHealth();
    }, this.healthCheckInterval);
    
    logger.info('Database health check started - checking every 30 seconds');
  }
}

module.exports = new DatabaseHealthCheck();