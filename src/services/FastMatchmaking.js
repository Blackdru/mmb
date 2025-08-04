const prisma = require('../config/database');
const logger = require('../config/logger');
const walletService = require('./walletService');
const gameService = require('./gameService');
const botService = require('./BotService');

/**
 * Fast Matchmaking Service with 3-tier deployment strategy
 * 0-15s: Human vs Human Priority
 * 15s: Bot Deployment
 * 30s: Guaranteed Deployment
 */
class FastMatchmakingService {
  constructor() {
    this.matchmakingInterval = null;
    this.onGameCreatedCallback = null;
    this.initialized = false;
    this.isProcessingMatchmaking = false;
    this.queueTimeoutTimers = new Map();
    
    // Configuration constants
    this.PROCESSING_INTERVAL = 5000; // 5 seconds - reduced frequency
    this.BOT_DEPLOYMENT_DELAY = 15000; // 15 seconds - bot deployment after human priority
    this.REAL_USER_RETRY_DELAY = 15000; // 15 seconds - human vs human priority window
    this.GUARANTEED_BOT_DELAY = 30000; // 30 seconds - guaranteed deployment
    this.QUEUE_TIMEOUT = 60000; // 1 minute for faster turnover
    this.MAX_CONCURRENT_GAMES = 1000; // Limit concurrent game creation
    this.activeGameCreations = 0;
  }

  /**
   * Initialize the matchmaking service
   */
  async initialize() {
    if (this.initialized) {
      logger.info('FastMatchmakingService already initialized');
      return;
    }
    
    try {
      this.startMatchmaking();
      this.initialized = true;
      logger.info('✅ FastMatchmakingService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize FastMatchmakingService:', error);
      throw error;
    }
  }

  /**
   * Start the matchmaking process
   */
  startMatchmaking() {
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
    }
    
    this.matchmakingInterval = setInterval(() => {
      this.processMatchmaking().catch(error => {
        logger.error('Matchmaking processing error:', error);
      });
    }, this.PROCESSING_INTERVAL);
    
    logger.info(`🚀 Fast matchmaking started - checking every ${this.PROCESSING_INTERVAL}ms`);
  }

  /**
   * Stop the matchmaking service
   */
  stop() {
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
      this.matchmakingInterval = null;
    }
    
    // Clear all timeout timers
    for (const [timeoutKey, timer] of this.queueTimeoutTimers.entries()) {
      clearTimeout(timer);
    }
    this.queueTimeoutTimers.clear();
    
    logger.info('FastMatchmakingService stopped');
  }

  /**
   * Set callback for game creation events
   */
  setGameCreatedCallback(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
    this.onGameCreatedCallback = callback;
  }

  /**
   * Add user to matchmaking queue
   */
  async joinQueue(userId, gameType, maxPlayers, entryFee) {
    if (!userId || !gameType || !maxPlayers) {
      throw new Error('Missing required parameters');
    }

    try {
      logger.info(`👤 User ${userId} joining queue: ${gameType} ${maxPlayers}P ₹${entryFee}`);
      
      // Validate entry fee and balance
      await this.validateUserBalance(userId, entryFee);

      // Remove user from existing queues
      await this.removeUserFromAllQueues(userId);

      // Deduct entry fee if applicable
      if (entryFee > 0) {
        await this.deductEntryFee(userId, entryFee);
      }

      // Add to queue
      const queueEntry = await this.addUserToQueue(userId, gameType, maxPlayers, entryFee);

      // Start timeout timer and trigger matchmaking
      this.startQueueTimeoutTimer(userId, gameType, maxPlayers, entryFee);
      setTimeout(() => this.processMatchmaking(), 500);

      logger.info(`✅ User ${userId} joined queue successfully`);
      return {
        success: true,
        message: 'Joined matchmaking queue',
        queueId: queueEntry.id
      };
    } catch (error) {
      logger.error(`Join queue error for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Remove user from matchmaking queue
   */
  async leaveQueue(userId) {
    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      const queueEntries = await prisma.matchmakingQueue.findMany({
        where: { userId }
      });
      
      const deletedCount = await prisma.matchmakingQueue.deleteMany({
        where: { userId }
      });
      
      this.clearAllTimeoutTimersForUser(userId);
      
      // Process refunds
      await this.processQueueRefunds(userId, queueEntries, 'Manual queue exit refund');
      
      logger.info(`User ${userId} left queue. Removed ${deletedCount.count} entries.`);
      return {
        success: true,
        message: 'Left matchmaking queue'
      };
    } catch (error) {
      logger.error(`Leave queue error for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Main matchmaking processing logic with priority system
   */
  async processMatchmaking() {
    if (this.isProcessingMatchmaking) {
      return;
    }

    this.isProcessingMatchmaking = true;
    
    try {
      logger.info('🔄 Processing fast matchmaking...');
      
      // Priority 1: Human vs Human matching (0-15 seconds)
      const humanMatches = await this.matchHumansInPriorityWindow();
      if (humanMatches > 0) {
        logger.info(`👥 HUMAN MATCH: Created ${humanMatches} games with real users!`);
        return;
      }
      
      // Priority 2: Bot deployment after 15 seconds
      const botMatches = await this.deployBotsAfter15Seconds();
      if (botMatches > 0) {
        logger.info(`🤖 15s BOT MATCH: Created ${botMatches} games with bots`);
        return;
      }
      
      // Priority 3: Guaranteed bot deployment after 30 seconds
      const guaranteedMatches = await this.guaranteedBotDeployment();
      if (guaranteedMatches > 0) {
        logger.info(`🚨 30s GUARANTEED BOT: Created ${guaranteedMatches} games`);
      }
      
    } catch (error) {
      logger.error('Matchmaking error:', error);
    } finally {
      this.isProcessingMatchmaking = false;
    }
  }

  /**
   * Match humans within priority window (0-15 seconds)
   */
  async matchHumansInPriorityWindow() {
    try {
      const realUserGroups = await this.getRealUserGroups();
      let gamesCreated = 0;
      
      for (const group of realUserGroups) {
        const { gameType, maxPlayers, entryFee } = group;
        const realUsersCount = group._count.id;

        if (realUsersCount >= maxPlayers) {
          logger.info(`👥 HUMAN PRIORITY: ${realUsersCount} real users for ${gameType} ${maxPlayers}P`);
          
          const possibleGames = Math.floor(realUsersCount / maxPlayers);
          gamesCreated += await this.createMultipleGames(gameType, maxPlayers, entryFee, possibleGames);
        }
      }
      
      return gamesCreated;
    } catch (error) {
      logger.error('Error in human priority matching:', error);
      return 0;
    }
  }

  /**
   * Deploy bots after 15 seconds
   */
  async deployBotsAfter15Seconds() {
    try {
      const waitingUsers = await this.getUsersWaitingForTime(
        this.BOT_DEPLOYMENT_DELAY, 
        this.GUARANTEED_BOT_DELAY
      );

      if (waitingUsers.length === 0) return 0;

      const validUsers = this.filterValidWaitingUsers(waitingUsers, this.BOT_DEPLOYMENT_DELAY);
      if (validUsers.length === 0) return 0;

      logger.info(`🤖 15s BOT DEPLOYMENT: Found ${validUsers.length} users waiting 15+ seconds`);
      
      return await this.deployBotsForWaitingUsers(validUsers, false);
    } catch (error) {
      logger.error('Error in 15s bot deployment:', error);
      return 0;
    }
  }



  /**
   * Guaranteed bot deployment after 30+ seconds
   */
  async guaranteedBotDeployment() {
    try {
      const waitingUsers = await this.getUsersWaitingForTime(this.GUARANTEED_BOT_DELAY);
      if (waitingUsers.length === 0) return 0;

      logger.info(`🚨 GUARANTEED BOT DEPLOYMENT: ${waitingUsers.length} users waiting 30+ seconds`);
      
      return await this.deployBotsForWaitingUsers(waitingUsers, true);
    } catch (error) {
      logger.error('🚨 GUARANTEED: Critical error in 30s bot deployment:', error);
      return 0;
    }
  }

  /**
   * Deploy bots for waiting users
   */
  async deployBotsForWaitingUsers(waitingUsers, isGuaranteed = false) {
    let gamesCreated = 0;
    const usersByConfig = this.groupUsersByConfig(waitingUsers);

    for (const [configKey, users] of usersByConfig) {
      const [gameType, maxPlayers, entryFee] = this.parseConfigKey(configKey);
      
      try {
        await this.ensureBotsAvailable(isGuaranteed ? 10 : 5);
        
        const botsNeeded = maxPlayers - users.length;
        if (botsNeeded > 0) {
          await this.deployRequiredBots(users[0].userId, gameType, entryFee, maxPlayers, botsNeeded, isGuaranteed);
        }

        // Attempt to create game
        const game = await this.createGameFast(gameType, maxPlayers, entryFee);
        if (game) {
          gamesCreated++;
          const label = isGuaranteed ? 'GUARANTEED' : 'STANDARD';
          logger.info(`🎮 ${label}: GAME CREATED: ${game.id}`);
        }
      } catch (error) {
        logger.error(`Failed to deploy bots for ${configKey}:`, error);
      }
    }

    return gamesCreated;
  }

  /**
   * Create game with optimized performance
   */
  async createGameFast(gameType, playersToMatch, entryFee) {
    try {
      logger.info(`🎮 Creating game: ${gameType} ${playersToMatch}P ₹${entryFee}`);
      
      // Step 1: Get players and create game in single transaction
      const { queueEntries, gameId } = await this.createGameTransaction(
        gameType, playersToMatch, entryFee
      );

      // Step 2: Setup game participants and data
      const finalGame = await this.setupGameParticipants(gameId, queueEntries, gameType);

      // Cleanup and notify
      this.cleanupSuccessfulGame(queueEntries);
      this.notifyGameCreated(finalGame, queueEntries);

      return finalGame;
    } catch (error) {
      logger.error('Create game error:', error);
      return error.message.includes('Insufficient players') ? null : error;
    }
  }

  /**
   * Get queue status for a user
   */
  async getQueueStatus(userId) {
    try {
      const queueEntry = await prisma.matchmakingQueue.findFirst({
        where: { userId }
      });

      if (!queueEntry) {
        return { inQueue: false, message: 'Not in queue' };
      }

      const playersInQueue = await prisma.matchmakingQueue.count({
        where: {
          gameType: queueEntry.gameType,
          maxPlayers: queueEntry.maxPlayers,
          entryFee: queueEntry.entryFee
        }
      });

      return {
        inQueue: true,
        gameType: queueEntry.gameType,
        maxPlayers: queueEntry.maxPlayers,
        entryFee: parseFloat(queueEntry.entryFee),
        playersInQueue,
        waitTime: Date.now() - queueEntry.createdAt.getTime()
      };
    } catch (error) {
      logger.error(`Get queue status error for user ${userId}:`, error);
      throw new Error('Failed to get queue status');
    }
  }

  // ==================== HELPER METHODS ====================

  /**
   * Validate user balance for entry fee
   */
  async validateUserBalance(userId, entryFee) {
    if (entryFee > 0) {
      const walletBalance = await walletService.getWalletBalance(userId);
      const totalBalance = (walletBalance.gameBalance || 0) + (walletBalance.withdrawableBalance || 0);
      if (totalBalance < entryFee) {
        throw new Error('Insufficient balance');
      }
    }
  }

  /**
   * Remove user from all existing queues
   */
  async removeUserFromAllQueues(userId) {
    await prisma.matchmakingQueue.deleteMany({
      where: { userId }
    });
    this.clearAllTimeoutTimersForUser(userId);
  }

  /**
   * Deduct entry fee from user wallet
   */
  async deductEntryFee(userId, entryFee) {
    const deductionResult = await walletService.deductGameEntry(
      userId, 
      entryFee, 
      `queue_${userId}_${Date.now()}`
    );
    
    if (!deductionResult.success) {
      logger.error(`Failed to deduct entry fee from user ${userId}: ${deductionResult.message}`);
      throw new Error(deductionResult.message || 'Failed to deduct entry fee');
    }
    
    logger.info(`✅ Entry fee ₹${entryFee} deducted from user ${userId}`);
  }

  /**
   * Add user to matchmaking queue
   */
  async addUserToQueue(userId, gameType, maxPlayers, entryFee) {
    return await prisma.matchmakingQueue.create({
      data: {
        userId,
        gameType,
        maxPlayers,
        entryFee
      }
    });
  }

  /**
   * Process refunds for queue entries
   */
  async processQueueRefunds(userId, queueEntries, reason) {
    for (const queueEntry of queueEntries) {
      if (queueEntry.entryFee > 0) {
        try {
          await walletService.creditWallet(
            userId,
            queueEntry.entryFee,
            'REFUND',
            null,
            reason
          );
          logger.info(`💰 Refunded ₹${queueEntry.entryFee} to user ${userId}`);
        } catch (refundError) {
          logger.error(`Failed to refund user ${userId}:`, refundError);
        }
      }
    }
  }

  /**
   * Get real user groups for matching
   */
  async getRealUserGroups() {
    return await prisma.matchmakingQueue.groupBy({
      by: ['gameType', 'maxPlayers', 'entryFee'],
      _count: { id: true },
      where: {
        user: { isBot: false }
      },
      having: {
        id: { _count: { gte: 2 } }
      },
      orderBy: {
        _count: { id: 'desc' }
      }
    });
  }

  /**
   * Get users waiting for specific time period
   */
  async getUsersWaitingForTime(minWaitTime, maxWaitTime = null) {
    const whereClause = {
      user: { isBot: false },
      createdAt: {
        lte: new Date(Date.now() - minWaitTime)
      }
    };

    if (maxWaitTime) {
      whereClause.createdAt.gte = new Date(Date.now() - maxWaitTime);
    }

    return await prisma.matchmakingQueue.findMany({
      where: whereClause,
      include: { user: true },
      orderBy: { createdAt: 'asc' }
    });
  }

  /**
   * Filter users who have actually waited the required time
   */
  filterValidWaitingUsers(users, minWaitTime) {
    return users.filter(user => {
      const waitTime = Date.now() - user.createdAt.getTime();
      return waitTime >= minWaitTime;
    });
  }

  /**
   * Get real user groups within time window
   */
  async getRealUserGroupsInTimeWindow(minWaitTime, maxWaitTime) {
    return await prisma.matchmakingQueue.groupBy({
      by: ['gameType', 'maxPlayers', 'entryFee'],
      _count: { id: true },
      where: {
        user: { isBot: false },
        createdAt: {
          lte: new Date(Date.now() - minWaitTime),
          gte: new Date(Date.now() - maxWaitTime)
        }
      },
      having: {
        id: { _count: { gte: 2 } }
      },
      orderBy: {
        _count: { id: 'desc' }
      }
    });
  }

  /**
   * Group users by game configuration
   */
  groupUsersByConfig(users) {
    const usersByConfig = new Map();
    
    users.forEach(user => {
      const key = `${user.gameType}_${user.maxPlayers}_${user.entryFee}`;
      if (!usersByConfig.has(key)) {
        usersByConfig.set(key, []);
      }
      usersByConfig.get(key).push(user);
    });
    
    return usersByConfig;
  }

  /**
   * Parse configuration key
   */
  parseConfigKey(configKey) {
    const [gameType, maxPlayers, entryFee] = configKey.split('_');
    return [gameType, parseInt(maxPlayers), parseFloat(entryFee)];
  }

  /**
   * Ensure minimum bots are available
   */
  async ensureBotsAvailable(minimumBots) {
    const availableBotsCount = await botService.getAvailableBotsCount();
    if (availableBotsCount < minimumBots) {
      logger.info(`🤖 Creating bots to meet minimum requirement: ${minimumBots}`);
      await botService.ensureMinimumBots(minimumBots);
    }
  }

  /**
   * Deploy required number of bots
   */
  async deployRequiredBots(userId, gameType, entryFee, maxPlayers, botsNeeded, isGuaranteed) {
    const label = isGuaranteed ? 'GUARANTEED' : 'STANDARD';
    logger.info(`🤖 ${label}: Deploying ${botsNeeded} bots`);
    
    if (isGuaranteed) {
      // Deploy bots in parallel for guaranteed deployment
      const botPromises = Array(botsNeeded).fill().map(() => 
        this.deploySingleBot(userId, gameType, entryFee, maxPlayers)
      );
      
      try {
        await Promise.all(botPromises);
      } catch (error) {
        logger.error(`🚨 GUARANTEED: Error deploying bots:`, error);
        // Fallback to individual deployment
        for (let i = 0; i < botsNeeded; i++) {
          try {
            await this.deploySingleBot(userId, gameType, entryFee, maxPlayers);
          } catch (individualError) {
            logger.error(`🚨 GUARANTEED: Individual bot deployment failed:`, individualError);
          }
        }
      }
    } else {
      // Sequential deployment for standard bots
      for (let i = 0; i < botsNeeded; i++) {
        try {
          await this.deploySingleBot(userId, gameType, entryFee, maxPlayers);
        } catch (error) {
          logger.error(`🤖 Failed to deploy bot ${i + 1}/${botsNeeded}:`, error);
        }
      }
    }
  }

  /**
   * Deploy a single bot
   */
  async deploySingleBot(userId, gameType, entryFee, maxPlayers) {
    try {
      const botUser = await this.getOptimalBot(userId, gameType, entryFee, maxPlayers);
      
      // Check if bot is already in queue
      const existingBotInQueue = await prisma.matchmakingQueue.findFirst({
        where: {
          userId: botUser.id,
          gameType,
          maxPlayers,
          entryFee
        }
      });

      if (!existingBotInQueue) {
        await prisma.matchmakingQueue.create({
          data: {
            userId: botUser.id,
            gameType,
            maxPlayers,
            entryFee
          }
        });
        
        logger.info(`✅ Bot ${botUser.name} (${botUser.id}) deployed to queue`);
        return botUser;
      } else {
        // Create new bot if existing one is already in queue
        const newBot = await botService.createBotUser();
        await prisma.matchmakingQueue.create({
          data: {
            userId: newBot.id,
            gameType,
            maxPlayers,
            entryFee
          }
        });
        logger.info(`✅ New bot ${newBot.name} deployed to queue`);
        return newBot;
      }
    } catch (error) {
      logger.error(`❌ Failed to deploy single bot:`, error);
      throw error;
    }
  }

  /**
   * Get optimal bot for deployment
   */
  async getOptimalBot(userId, gameType, entryFee, maxPlayers) {
    try {
      await botService.ensureMinimumBots(15);
      
      // Get recent opponents to avoid repetition
      const recentBotIds = await this.getRecentBotOpponents(userId, gameType);
      
      // Find available bots
      const availableBots = await this.findAvailableBots(recentBotIds);
      
      let selectedBot;
      if (availableBots.length > 0) {
        selectedBot = availableBots[Math.floor(Math.random() * availableBots.length)];
        logger.info(`🤖 Selected existing bot: ${selectedBot.name} from ${availableBots.length} available`);
      } else {
        selectedBot = await botService.createBotUser();
        logger.info(`🤖 Created new bot: ${selectedBot.name}`);
      }

      // Ensure bot has sufficient balance
      await this.ensureBotBalance(selectedBot, entryFee);
      
      return selectedBot;
    } catch (error) {
      logger.error('Error getting optimal bot:', error);
      // Fallback to bot service
      return await botService.getBotForMatchmaking(gameType, entryFee, maxPlayers);
    }
  }

  /**
   * Get recent bot opponents for a user
   */
  async getRecentBotOpponents(userId, gameType) {
    const recentGames = await prisma.gameParticipation.findMany({
      where: {
        userId,
        game: {
          type: gameType,
          status: "FINISHED"
        }
      },
      include: {
        game: {
          include: {
            participants: {
              include: { user: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    const recentBotIds = new Set();
    recentGames.forEach(participation => {
      participation.game.participants.forEach(participant => {
        if (participant.user.isBot && participant.userId !== userId) {
          recentBotIds.add(participant.userId);
        }
      });
    });

    return Array.from(recentBotIds);
  }

  /**
   * Find available bots excluding recent opponents
   */
  async findAvailableBots(recentBotIds) {
    return await prisma.user.findMany({
      where: {
        isBot: true,
        id: { notIn: recentBotIds },
        matchmakingQueues: { none: {} },
        gameParticipations: {
          none: {
            game: {
              status: { in: ['WAITING', 'PLAYING'] }
            }
          }
        }
      }
    });
  }

  /**
   * Ensure bot has sufficient balance
   */
  async ensureBotBalance(bot, entryFee) {
    if (entryFee > 0) {
      const currentWallet = await prisma.wallet.findUnique({
        where: { userId: bot.id }
      });
      
      if (!currentWallet || currentWallet.gameBalance < entryFee) {
        const amountToAdd = Math.max(1000, entryFee * 10);
        
        await prisma.wallet.upsert({
          where: { userId: bot.id },
          update: {
            gameBalance: { increment: amountToAdd },
            balance: { increment: amountToAdd }
          },
          create: {
            userId: bot.id,
            balance: amountToAdd,
            gameBalance: amountToAdd,
            withdrawableBalance: 0
          }
        });
        
        logger.info(`🤖 Added ₹${amountToAdd} to bot ${bot.name} wallet`);
      }
    }
  }

  /**
   * Create multiple games of the same configuration
   */
  async createMultipleGames(gameType, maxPlayers, entryFee, gameCount) {
    let created = 0;
    
    for (let i = 0; i < gameCount; i++) {
      try {
        const game = await this.createGameFast(gameType, maxPlayers, entryFee);
        if (game) {
          created++;
          logger.info(`⚡ CREATED GAME ${i + 1}/${gameCount}: ${game.id}`);
        } else {
          break; // No more players available
        }
      } catch (error) {
        logger.error(`Failed to create game ${i + 1}/${gameCount}:`, error);
        break;
      }
    }
    
    return created;
  }

  /**
   * Create game transaction
   */
  async createGameTransaction(gameType, playersToMatch, entryFee) {
    return await prisma.$transaction(async (tx) => {
      const queueEntries = await tx.matchmakingQueue.findMany({
        where: {
          gameType,
          maxPlayers: playersToMatch,
          entryFee
        },
        take: playersToMatch,
        include: { user: true },
        orderBy: { createdAt: 'asc' },
        distinct: ['userId']
      });

      if (queueEntries.length < playersToMatch) {
        throw new Error(`Insufficient players: needed ${playersToMatch}, found ${queueEntries.length}`);
      }

      const totalEntryFees = entryFee * playersToMatch;
      const prizePool = totalEntryFees * 0.8;

      const game = await tx.game.create({
        data: {
          type: gameType,
          maxPlayers: playersToMatch,
          entryFee,
          prizePool,
          status: 'WAITING',
          gameData: {},
        }
      });

      await tx.matchmakingQueue.deleteMany({
        where: { id: { in: queueEntries.map(entry => entry.id) } }
      });

      return { queueEntries, gameId: game.id };
    }, { timeout: 30000, maxWait: 20000 });
  }

  /**
   * Setup game participants
   */
  async setupGameParticipants(gameId, queueEntries, gameType) {
    return await prisma.$transaction(async (tx) => {
      const colors = ['red', 'blue', 'green', 'yellow'];
      const participationData = queueEntries.map((queueEntry, i) => ({
        userId: queueEntry.userId,
        gameId: gameId,
        position: i,
        color: colors[i % colors.length],
        score: 0
      }));

      await tx.gameParticipation.createMany({
        data: participationData
      });

      let gameData = {};
      if (gameType === 'MEMORY') {
        gameData = gameService.initializeMemoryGameBoard();
      }

      return await tx.game.update({
        where: { id: gameId },
        data: { gameData },
        include: { participants: true }
      });
    }, { timeout: 30000, maxWait: 20000 });
  }

  /**
   * Cleanup after successful game creation
   */
  cleanupSuccessfulGame(queueEntries) {
    queueEntries.forEach(entry => {
      this.clearAllTimeoutTimersForUser(entry.userId);
    });
  }

  /**
   * Notify callback about game creation
   */
  notifyGameCreated(game, queueEntries) {
    if (this.onGameCreatedCallback) {
      const users = queueEntries.map(q => q.user);
      this.onGameCreatedCallback(game, users);
    }
  }

  /**
   * Start queue timeout timer for a user
   */
  startQueueTimeoutTimer(userId, gameType, maxPlayers, entryFee) {
    const timeoutKey = `${userId}_${gameType}_${maxPlayers}_${entryFee}`;
    
    if (this.queueTimeoutTimers.has(timeoutKey)) {
      clearTimeout(this.queueTimeoutTimers.get(timeoutKey));
    }
    
    const timer = setTimeout(async () => {
      try {
        await this.handleQueueTimeout(userId, gameType, maxPlayers, entryFee);
        this.queueTimeoutTimers.delete(timeoutKey);
      } catch (error) {
        logger.error(`Error handling queue timeout for user ${userId}:`, error);
        this.queueTimeoutTimers.delete(timeoutKey);
      }
    }, this.QUEUE_TIMEOUT);

    this.queueTimeoutTimers.set(timeoutKey, timer);
  }

  /**
   * Handle queue timeout for a user
   */
  async handleQueueTimeout(userId, gameType, maxPlayers, entryFee) {
    try {
      const queueEntry = await prisma.matchmakingQueue.findFirst({
        where: { userId, gameType, maxPlayers, entryFee }
      });

      if (!queueEntry) return;

      logger.info(`⏰ Queue timeout for user ${userId}`);

      await prisma.matchmakingQueue.deleteMany({
        where: { userId }
      });

      // Process refund
      if (entryFee > 0) {
        try {
          await walletService.creditWallet(
            userId,
            entryFee,
            'REFUND',
            null,
            'Queue timeout refund'
          );
          logger.info(`💰 Refunded ₹${entryFee} to user ${userId}`);
        } catch (refundError) {
          logger.error(`Failed to refund user ${userId}:`, refundError);
        }
      }

      // Notify callback about timeout
      if (this.onGameCreatedCallback) {
        this.onGameCreatedCallback(null, null, {
          type: 'QUEUE_TIMEOUT',
          userId,
          gameType,
          maxPlayers,
          entryFee,
          message: 'No players found. Please try again later.',
          refunded: entryFee > 0
        });
      }

    } catch (error) {
      logger.error(`Error in handleQueueTimeout for user ${userId}:`, error);
    }
  }

  /**
   * Clear all timeout timers for a specific user
   */
  clearAllTimeoutTimersForUser(userId) {
    const timersToDelete = [];
    
    for (const [timeoutKey, timer] of this.queueTimeoutTimers.entries()) {
      if (timeoutKey.startsWith(`${userId}_`)) {
        clearTimeout(timer);
        timersToDelete.push(timeoutKey);
      }
    }
    
    timersToDelete.forEach(timeoutKey => {
      this.queueTimeoutTimers.delete(timeoutKey);
    });
  }
}

module.exports = new FastMatchmakingService();