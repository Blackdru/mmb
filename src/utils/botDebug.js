const prisma = require('../config/database');
const logger = require('../config/logger');

class BotDebugger {
  async debugBotSelection() {
    try {
      logger.info('🔍 Starting bot selection debugging...');
      
      // 1. Check total bots in database
      const totalBots = await prisma.user.count({
        where: { isBot: true }
      });
      logger.info(`📊 Total bots in database: ${totalBots}`);
      
      // 2. Check bots in queue
      const botsInQueue = await prisma.matchmakingQueue.count({
        where: {
          user: { isBot: true }
        }
      });
      logger.info(`📊 Bots currently in queue: ${botsInQueue}`);
      
      // 3. Check bots in active games
      const botsInGames = await prisma.gameParticipation.count({
        where: {
          user: { isBot: true },
          game: {
            status: {
              in: ['WAITING', 'PLAYING']
            }
          }
        }
      });
      logger.info(`📊 Bots in active games: ${botsInGames}`);
      
      // 4. Check available bots (same query as BotService)
      const availableBots = await prisma.user.findMany({
        where: {
          isBot: true,
          matchmakingQueues: {
            none: {}
          },
          gameParticipations: {
            none: {
              game: {
                status: {
                  in: ['WAITING', 'PLAYING']
                }
              }
            }
          }
        },
        include: { wallet: true }
      });
      
      logger.info(`📊 Available bots for selection: ${availableBots.length}`);
      if (availableBots.length > 0) {
        logger.info(`📊 Available bot details:`);
        availableBots.forEach((bot, index) => {
          logger.info(`   ${index + 1}. ${bot.name} (${bot.id}) - Balance: ₹${bot.wallet?.gameBalance || 0}`);
        });
      }
      
      // 5. List all bots with their current status
      const allBots = await prisma.user.findMany({
        where: { isBot: true },
        include: {
          matchmakingQueues: true,
          gameParticipations: {
            include: {
              game: true
            }
          },
          wallet: true
        }
      });
      
      logger.info(`📊 All bots status:`);
      allBots.forEach((bot, index) => {
        const inQueue = bot.matchmakingQueues.length > 0;
        const inActiveGame = bot.gameParticipations.some(p => 
          p.game.status === 'WAITING' || p.game.status === 'PLAYING'
        );
        const status = inQueue ? 'IN_QUEUE' : inActiveGame ? 'IN_GAME' : 'AVAILABLE';
        logger.info(`   ${index + 1}. ${bot.name} (${bot.id}) - Status: ${status}`);
      });
      
      return {
        totalBots,
        botsInQueue,
        botsInGames,
        availableBots: availableBots.length,
        allBots: allBots.map(bot => ({
          id: bot.id,
          name: bot.name,
          inQueue: bot.matchmakingQueues.length > 0,
          inActiveGame: bot.gameParticipations.some(p => 
            p.game.status === 'WAITING' || p.game.status === 'PLAYING'
          )
        }))
      };
      
    } catch (error) {
      logger.error('Error in bot debugging:', error);
      throw error;
    }
  }
  
  async cleanupStuckBots() {
    try {
      logger.info('🧹 Cleaning up stuck bots...');
      
      // Remove bots from old finished games
      const cleanedParticipations = await prisma.gameParticipation.deleteMany({
        where: {
          user: { isBot: true },
          game: {
            status: 'FINISHED'
          }
        }
      });
      logger.info(`🧹 Cleaned ${cleanedParticipations.count} bot participations from finished games`);
      
      // Remove bots from old queues (older than 10 minutes)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const cleanedQueues = await prisma.matchmakingQueue.deleteMany({
        where: {
          user: { isBot: true },
          createdAt: { lt: tenMinutesAgo }
        }
      });
      logger.info(`🧹 Cleaned ${cleanedQueues.count} old bot queue entries`);
      
      return {
        cleanedParticipations: cleanedParticipations.count,
        cleanedQueues: cleanedQueues.count
      };
      
    } catch (error) {
      logger.error('Error cleaning up stuck bots:', error);
      throw error;
    }
  }
  
  async forceCreateBots(count = 5) {
    try {
      logger.info(`🤖 Force creating ${count} new bots...`);
      
      const botNames = [
        'TestBot1', 'TestBot2', 'TestBot3', 'TestBot4', 'TestBot5',
        'DebugBot1', 'DebugBot2', 'DebugBot3', 'DebugBot4', 'DebugBot5'
      ];
      
      const createdBots = [];
      for (let i = 0; i < count; i++) {
        const botName = `${botNames[i % botNames.length]}${Date.now()}${i}`;
        const botPhone = `+91${Math.floor(Math.random() * 9000000000) + 1000000000}`;
        
        const bot = await prisma.user.create({
          data: {
            phoneNumber: botPhone,
            name: botName,
            isVerified: true,
            isBot: true,
            wallet: {
              create: {
                balance: 1000,
                gameBalance: 1000,
                withdrawableBalance: 0
              }
            }
          },
          include: { wallet: true }
        });
        
        createdBots.push(bot);
        logger.info(`🤖 Created bot: ${bot.name} (${bot.id})`);
      }
      
      return createdBots;
      
    } catch (error) {
      logger.error('Error force creating bots:', error);
      throw error;
    }
  }
}

module.exports = new BotDebugger();