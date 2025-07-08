const logger = require('../../config/logger');
const prisma = require('../../config/database');
const botService = require('../../services/BotService');

class BotMatchmakingService {
  constructor() {
    this.botDeploymentTimers = new Map(); // Track bot deployment timers for each queue
  }

  // Start bot deployment timer for a specific queue configuration
  startBotDeploymentTimer(gameType, maxPlayers, entryFee) {
    const queueKey = `${gameType}_${maxPlayers}_${entryFee}`;
    
    // Generate unique timer key with timestamp
    const uniqueTimerKey = `${queueKey}_${Date.now()}`;
    
    logger.info(`🤖 Starting bot deployment timer for queue: ${queueKey} (30 seconds) - Timer ID: ${uniqueTimerKey}`);
    
    const timer = setTimeout(async () => {
      try {
        await this.deployBotIfNeeded(gameType, maxPlayers, entryFee);
        this.botDeploymentTimers.delete(uniqueTimerKey);
      } catch (error) {
        logger.error(`Error deploying bot for queue ${queueKey}:`, error);
        this.botDeploymentTimers.delete(uniqueTimerKey);
      }
    }, 30000); // 30 seconds delay before deploying bot
    
    this.botDeploymentTimers.set(uniqueTimerKey, timer);
  }

  // Deploy a bot if there are waiting players but not enough for a full game
  async deployBotIfNeeded(gameType, maxPlayers, entryFee) {
    try {
      logger.info(`🤖 Checking if bot deployment needed for: ${gameType} ${maxPlayers}P ₹${entryFee}`);
      
      // Check how many players are in the queue
      const queueCount = await prisma.matchmakingQueue.count({
        where: {
          gameType,
          maxPlayers,
          entryFee
        }
      });
      
      logger.info(`📊 Players in queue: ${queueCount}/${maxPlayers}`);
      
      // Deploy bot if we have human players waiting but not enough for a full game
      if (queueCount > 0 && queueCount < maxPlayers) {
        // Check if there are any human players (non-bots) in the queue
        const humanPlayersCount = await prisma.matchmakingQueue.count({
          where: {
            gameType,
            maxPlayers,
            entryFee,
            user: {
              isBot: false
            }
          }
        });
        
        if (humanPlayersCount > 0) {
          logger.info(`🤖 Deploying bot for ${gameType} game - ${humanPlayersCount} human player(s) waiting`);
          
          try {
            // Get bot for matchmaking
            const botUser = await botService.getBotForMatchmaking(gameType, entryFee);
            
            logger.info(`🤖 Bot ${botUser.name} (${botUser.id}) added to queue for ${gameType} ${maxPlayers}P ₹${entryFee}`);
            
            // Bot added to queue via getBotForMatchmaking, no additional action needed
            return botUser;
          } catch (botError) {
            logger.error(`Failed to deploy bot: ${botError.message}`);
          }
        } else {
          logger.info(`🤖 Only bots in queue for ${gameType} ${maxPlayers}P ₹${entryFee} - not deploying additional bot`);
        }
      } else if (queueCount === 0) {
        logger.info(`📭 No players in queue for ${gameType} ${maxPlayers}P ₹${entryFee} - bot deployment not needed`);
      } else {
        logger.info(`✅ Enough players (${queueCount}) for ${gameType} ${maxPlayers}P ₹${entryFee} - bot deployment not needed`);
      }
      
    } catch (error) {
      logger.error(`Error in bot deployment for ${gameType} ${maxPlayers}P ₹${entryFee}:`, error);
    }
  }

  // Clear bot deployment timer when a queue gets enough players
  clearBotDeploymentTimer(gameType, maxPlayers, entryFee) {
    const queueKey = `${gameType}_${maxPlayers}_${entryFee}`;
    let timersCleared = 0;
    
    // Clear all timers that match this queue configuration
    for (const [timerKey, timer] of this.botDeploymentTimers.entries()) {
      if (timerKey.startsWith(queueKey)) {
        clearTimeout(timer);
        this.botDeploymentTimers.delete(timerKey);
        timersCleared++;
      }
    }
    
    if (timersCleared > 0) {
      logger.info(`🤖 Cleared ${timersCleared} bot deployment timer(s) for: ${queueKey}`);
    }
  }

  // Clear all bot deployment timers
  clearAllBotTimers() {
    for (const [queueKey, timer] of this.botDeploymentTimers.entries()) {
      clearTimeout(timer);
      logger.info(`Cleared bot deployment timer for queue: ${queueKey}`);
    }
    this.botDeploymentTimers.clear();
  }
}

module.exports = new BotMatchmakingService();