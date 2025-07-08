const prisma = require('../config/database');
const logger = require('../config/logger');

class BotService {
  constructor() {
    this.botNames = [
      'GameMaster', 'ProPlayer', 'MemoryKing', 'CardShark', 'BrainBox',
      'QuickThink', 'MindReader', 'FlashCard', 'MemoryAce', 'ThinkFast'
    ];
  }

  async createBotUser() {
    try {
      const botName = this.botNames[Math.floor(Math.random() * this.botNames.length)];
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

      logger.info(`Bot user created: ${bot.name} (${bot.id})`);
      return bot;
    } catch (error) {
      logger.error('Create bot user error:', error);
      throw error;
    }
  }

  async getBotForMatchmaking(gameType, entryFee) {
    try {
      logger.info(`🤖 Looking for available bot for ${gameType} with entry fee ₹${entryFee}`);
      
      // Try to find an existing bot that's not in queue and not currently playing
      let bot = await prisma.user.findFirst({
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

      // If no available bot, create one
      if (!bot) {
        logger.info(`🤖 No available bot found, creating new bot`);
        bot = await this.createBotUser();
      } else {
        logger.info(`🤖 Found available bot: ${bot.name} (${bot.id})`);
      }

      // Ensure bot has sufficient balance for the game
      if (entryFee > 0 && bot.wallet && bot.wallet.gameBalance < entryFee) {
        logger.info(`🤖 Bot ${bot.name} has insufficient balance (₹${bot.wallet.gameBalance}), adding funds`);
        await prisma.wallet.update({
          where: { userId: bot.id },
          data: {
            gameBalance: { increment: Math.max(1000, entryFee * 10) },
            balance: { increment: Math.max(1000, entryFee * 10) }
          }
        });
      }

      // Add bot to matchmaking queue
      const queueEntry = await prisma.matchmakingQueue.create({
        data: {
          userId: bot.id,
          gameType,
          maxPlayers: 2,
          entryFee
        }
      });

      logger.info(`🤖 Bot ${bot.name} (${bot.id}) successfully added to matchmaking queue (${queueEntry.id}) for ${gameType}`);
      return bot;
    } catch (error) {
      logger.error('Get bot for matchmaking error:', error);
      throw error;
    }
  }

  async removeBotFromQueue(botId) {
    try {
      await prisma.matchmakingQueue.deleteMany({
        where: { userId: botId }
      });
      logger.info(`Bot ${botId} removed from matchmaking queue`);
    } catch (error) {
      logger.error('Remove bot from queue error:', error);
    }
  }

  async getAvailableBotsCount() {
    try {
      const count = await prisma.user.count({
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
        }
      });
      return count;
    } catch (error) {
      logger.error('Get available bots count error:', error);
      return 0;
    }
  }

  async ensureMinimumBots(minCount = 5) {
    try {
      const availableCount = await this.getAvailableBotsCount();
      logger.info(`🤖 Available bots: ${availableCount}, minimum required: ${minCount}`);
      
      if (availableCount < minCount) {
        const botsToCreate = minCount - availableCount;
        logger.info(`🤖 Creating ${botsToCreate} additional bots`);
        
        const promises = [];
        for (let i = 0; i < botsToCreate; i++) {
          promises.push(this.createBotUser());
        }
        
        await Promise.all(promises);
        logger.info(`🤖 Successfully created ${botsToCreate} new bots`);
      }
    } catch (error) {
      logger.error('Ensure minimum bots error:', error);
    }
  }

  async cleanupInactiveBots() {
    try {
      // Remove bots that have been in queue for more than 5 minutes
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const inactiveBots = await prisma.matchmakingQueue.findMany({
        where: {
          createdAt: { lt: fiveMinutesAgo },
          user: { isBot: true }
        },
        include: { user: true }
      });

      for (const entry of inactiveBots) {
        await this.removeBotFromQueue(entry.userId);
      }

      logger.info(`Cleaned up ${inactiveBots.length} inactive bots`);
    } catch (error) {
      logger.error('Cleanup inactive bots error:', error);
    }
  }
}

module.exports = new BotService();