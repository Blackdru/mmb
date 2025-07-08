const prisma = require('../config/database');
const logger = require('../config/logger');

class BotService {
  constructor() {
    this.botProfiles = [
  { name: 'NareshMj', skillLevel: 0.88 },
  { name: 'Rajeev', skillLevel: 0.76 },
  { name: 'Siddharth', skillLevel: 0.90 },
  { name: 'Swamycharan', skillLevel: 0.65 },
  { name: 'Raghav', skillLevel: 0.70 },
  { name: 'Varun', skillLevel: 0.67 },
  { name: 'Ganesh', skillLevel: 0.92 },
  { name: 'Nikhil', skillLevel: 0.60 },
  { name: 'Ritesh', skillLevel: 0.84 },
  { name: 'Aman', skillLevel: 0.55 },
  { name: 'Mahesh', skillLevel: 0.80 },
  { name: 'Vikas', skillLevel: 0.72 },
  { name: 'Ankit', skillLevel: 0.69 },
  { name: 'Abhishek', skillLevel: 0.77 },
  { name: 'Balaji', skillLevel: 0.86 },
  { name: 'Vishal', skillLevel: 0.68 },
  { name: 'Vivek', skillLevel: 0.73 },
  { name: 'Praveen', skillLevel: 0.71 },
  { name: 'Kiran', skillLevel: 0.63 },
  { name: 'Dinesh', skillLevel: 0.66 },
  { name: 'Harshad', skillLevel: 0.61 },
  { name: 'Bala', skillLevel: 0.59 },
  { name: 'Chandan', skillLevel: 0.65 },
  { name: 'Chetan', skillLevel: 0.74 },
  { name: 'Pawan', skillLevel: 0.67 },
  { name: 'Jagadeesh', skillLevel: 0.69 },
  { name: 'Tejaswi', skillLevel: 0.78 },
  { name: 'Veerendra', skillLevel: 0.82 },
  { name: 'Ramakrishna', skillLevel: 0.87 },
  { name: 'Aditya', skillLevel: 0.91},
  { name: 'Srinivas', skillLevel: 0.64 },
  { name: 'Vinay', skillLevel: 0.70 },
  { name: 'Yashwanth', skillLevel: 0.79 },
  { name: 'Jayanthi', skillLevel: 0.62 },
  { name: 'Arjun', skillLevel: 0.85 },
  { name: 'Krishna', skillLevel: 0.89 },
  { name: 'Suresh', skillLevel: 0.73 },
  { name: 'Nagaraju', skillLevel: 0.58 },
  { name: 'Vijaya', skillLevel: 0.75 },
  { name: 'Uday', skillLevel: 0.68 },
  { name: 'Sandeep', skillLevel: 0.81 },
  { name: 'Karthik', skillLevel: 0.77 },
  { name: 'Prasad', skillLevel: 0.66 },
  { name: 'Veera', skillLevel: 0.72 },
  { name: 'Narayan', skillLevel: 0.84 },
  { name: 'Kalyan', skillLevel: 0.74 },
  { name: 'Satya', skillLevel: 0.79 },
  { name: 'Amarnath', skillLevel: 0.70 },
  { name: 'Veerabhadra', skillLevel: 0.86 },
  { name: 'Vijay', skillLevel: 0.83 },
  { name: 'Gopal', skillLevel: 0.76 }
]


  }

  async createBotUser() {
    try {
      // Select a bot profile with skill level
      const profile = this.botProfiles[Math.floor(Math.random() * this.botProfiles.length)];
      const uniqueId = Math.floor(Math.random() * 999) + 1;
      const botName = `${profile.name}${uniqueId}`;
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
          maxPlayers: 2, // Memory game is 2 players
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