const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error'] : ['error'],
  errorFormat: 'pretty',
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // Optimize connection pooling for high concurrency
  __internal: {
    engine: {
      connectTimeout: 60000, // 60 seconds
      pool_timeout: 60000, // 60 seconds
    },
  },
});

// Connection retry logic
let retryCount = 0;
const maxRetries = 3;

async function connectWithRetry() {
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully');
    retryCount = 0; // Reset on successful connection
  } catch (error) {
    retryCount++;
    console.error(`❌ Database connection failed (attempt ${retryCount}/${maxRetries}):`, error.message);
    
    if (retryCount < maxRetries) {
      console.log(`🔄 Retrying database connection in 5 seconds...`);
      setTimeout(connectWithRetry, 5000);
    } else {
      console.error('🚨 Max database connection retries exceeded');
    }
  }
}

// Initialize connection
connectWithRetry();

// Handle connection errors during runtime
prisma.$on('error', (e) => {
  console.error('Database runtime error:', e);
  // Attempt to reconnect
  setTimeout(connectWithRetry, 1000);
});

// Skip connection test to avoid using connections
// Connection will be tested when first query is made

// Handle graceful shutdown
process.on('beforeExit', async () => {
  try {
    console.log('Disconnecting from database...');
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error disconnecting from database:', error);
  }
});

process.on('SIGINT', async () => {
  try {
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  try {
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
});

module.exports = prisma;
