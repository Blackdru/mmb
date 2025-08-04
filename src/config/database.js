const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error'] : ['error'],
  errorFormat: 'pretty',
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
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
