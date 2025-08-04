const logger = require('./logger');

// Environment configuration validation
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'PORT'
];

const optionalEnvVars = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RENFLAIR_API_KEY',
  'NODE_ENV',
  'FRONTEND_URL'
];

function validateEnvironment() {
  const missing = [];
  const warnings = [];

  // Check required variables
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  // Check optional but important variables
  for (const envVar of optionalEnvVars) {
    if (!process.env[envVar]) {
      warnings.push(envVar);
    }
  }

  // Validate specific configurations
  if (process.env.JWT_SECRET === 'your_super_secret_jwt_key_here_change_in_production') {
    warnings.push('JWT_SECRET is using default value - change in production!');
  }

  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_ID.includes('XXXXXXXXX')) {
    warnings.push('RAZORPAY_KEY_ID appears to be placeholder - update with real keys');
  }

  if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL?.includes('localhost')) {
    warnings.push('Using localhost database in production environment');
  }

  // Report results
  if (missing.length > 0) {
    logger.error('Missing required environment variables:', missing);
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (warnings.length > 0) {
    logger.warn('Environment configuration warnings:', warnings);
  }

  logger.info('Environment validation completed successfully');
}

// Configuration object with defaults
const config = {
  // Server
  port: parseInt(process.env.PORT) || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Database
  databaseUrl: process.env.DATABASE_URL,
  
  // JWT
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  
  // Payment
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    enabled: process.env.RAZORPAY_ENABLED === 'true'
  },
  
  // SMS
  renflairApiKey: process.env.RENFLAIR_API_KEY,
  
  // App
  appName: process.env.APP_NAME || 'Budzee Gaming',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  
  // Socket.IO
  socket: {
    pingTimeout: parseInt(process.env.SOCKET_PING_TIMEOUT) || 60000,
    pingInterval: parseInt(process.env.SOCKET_PING_INTERVAL) || 25000
  },
  
  // Performance
  performance: {
    enableMonitoring: process.env.ENABLE_PERFORMANCE_MONITORING !== 'false',
    enableCaching: process.env.ENABLE_CACHING !== 'false'
  },
  
  // Security
  security: {
    enableRateLimit: process.env.ENABLE_RATE_LIMIT !== 'false',
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 200
  }
};

// Validate on module load
validateEnvironment();

module.exports = config;