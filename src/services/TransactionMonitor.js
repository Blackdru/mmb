// Enhanced Transaction Monitoring for Rapid Transactions
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class TransactionMonitor {
  constructor() {
    this.rapidTransactionThreshold = 5000; // 5 seconds
    this.alertThreshold = 5; // Alert if user has 5+ rapid transactions
    this.monitoringInterval = 30000; // Check every 30 seconds
  }

  async startMonitoring() {
    console.log('🔍 Starting enhanced transaction monitoring...');
    
    setInterval(async () => {
      await this.checkRapidTransactions();
    }, this.monitoringInterval);
    
    // Run immediately
    await this.checkRapidTransactions();
  }

  async checkRapidTransactions() {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      // Find users with rapid transactions in last 5 minutes
      const rapidUsers = await prisma.transaction.groupBy({
        by: ['userId'],
        where: {
          type: 'GAME_ENTRY',
          createdAt: { gte: fiveMinutesAgo }
        },
        _count: { id: true },
        having: {
          id: { _count: { gte: this.alertThreshold } }
        }
      });

      for (const userGroup of rapidUsers) {
        const transactions = await prisma.transaction.findMany({
          where: {
            userId: userGroup.userId,
            type: 'GAME_ENTRY',
            createdAt: { gte: fiveMinutesAgo }
          },
          orderBy: { createdAt: 'desc' }
        });

        // Check for transactions within threshold
        let rapidCount = 0;
        for (let i = 1; i < transactions.length; i++) {
          const timeDiff = new Date(transactions[i-1].createdAt) - new Date(transactions[i].createdAt);
          if (timeDiff < this.rapidTransactionThreshold) {
            rapidCount++;
          }
        }

        if (rapidCount >= 3) {
          console.log(`🚨 ALERT: User ${userGroup.userId} has ${rapidCount} rapid transactions`);
          
          // Log alert
          await this.logAlert(userGroup.userId, rapidCount, transactions);
        }
      }
      
    } catch (error) {
      console.error('❌ Error in transaction monitoring:', error);
    }
  }

  async logAlert(userId, rapidCount, transactions) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, isBot: true }
      });

      console.log(`📝 Logging alert for user ${user?.name || 'Unknown'} (${userId})`);
      
      // Create alert transaction for tracking
      await prisma.transaction.create({
        data: {
          userId,
          type: 'REFUND',
          amount: 0,
          status: 'COMPLETED',
          description: `MONITORING ALERT: ${rapidCount} rapid transactions detected in 5 minutes`
        }
      });

    } catch (error) {
      console.error('❌ Error logging alert:', error);
    }
  }

  async getUserRapidTransactionStats(userId, hours = 1) {
    const timeAgo = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        type: 'GAME_ENTRY',
        createdAt: { gte: timeAgo }
      },
      orderBy: { createdAt: 'desc' }
    });

    let rapidCount = 0;
    const rapidPairs = [];

    for (let i = 1; i < transactions.length; i++) {
      const timeDiff = new Date(transactions[i-1].createdAt) - new Date(transactions[i].createdAt);
      if (timeDiff < this.rapidTransactionThreshold) {
        rapidCount++;
        rapidPairs.push({
          tx1: transactions[i-1],
          tx2: transactions[i],
          timeDiff
        });
      }
    }

    return {
      totalTransactions: transactions.length,
      rapidTransactions: rapidCount,
      rapidPairs,
      timeWindow: hours
    };
  }
}

const monitor = new TransactionMonitor();

// Auto-start monitoring
if (require.main === module) {
  monitor.startMonitoring();
}

module.exports = { TransactionMonitor, monitor };