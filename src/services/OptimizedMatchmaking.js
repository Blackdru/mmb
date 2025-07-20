const prisma = require('../config/database');
const logger = require('../config/logger');
const walletService = require('./walletService');
const gameService = require('./gameService');
const botService = require('./BotService');

class OptimizedMatchmakingService {
  constructor() {
    this.matchmakingInterval = null;
    this.onGameCreatedCallback = null;
    this.initialized = false;
    this.isProcessingMatchmaking = false;
    this.queueTimeoutTimers = new Map();
  }

  async initialize() {
    if (this.initialized) {
      logger.info('OptimizedMatchmakingService already initialized');
      return;
    }
    
    try {
      this.startMatchmaking();
      this.initialized = true;
      logger.info('✅ OptimizedMatchmakingService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize OptimizedMatchmakingService:', error);
      throw error;
    }
  }

  startMatchmaking() {
    // Run matchmaking every 2 seconds for optimal performance
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
    }
    this.matchmakingInterval = setInterval(() => {
      this.processMatchmaking();
    }, 2000);
    logger.info('🚀 Optimized matchmaking started - checking every 2 seconds');
  }

  stop() {
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
      this.matchmakingInterval = null;
      logger.info('Matchmaking interval stopped.');
    }
    
    // Clear all timeout timers
    for (const [timeoutKey, timer] of this.queueTimeoutTimers.entries()) {
      clearTimeout(timer);
    }
    this.queueTimeoutTimers.clear();
  }

  setGameCreatedCallback(callback) {
    this.onGameCreatedCallback = callback;
  }

  async joinQueue(userId, gameType, maxPlayers, entryFee) {
    try {
      logger.info(`👤 User ${userId} joining queue: ${gameType} ${maxPlayers}P ₹${entryFee}`);
      
      // Check balance for paid games
      if (entryFee > 0) {
        const walletBalance = await walletService.getWalletBalance(userId);
        const totalBalance = (walletBalance.gameBalance || 0) + (walletBalance.withdrawableBalance || 0);
        if (totalBalance < entryFee) {
          throw new Error('Insufficient balance');
        }
      }

      // Remove user from any existing queues
      await prisma.matchmakingQueue.deleteMany({
        where: { userId }
      });
      this.clearAllTimeoutTimersForUser(userId);

      // Add to new queue
      const queueEntry = await prisma.matchmakingQueue.create({
        data: {
          userId,
          gameType,
          maxPlayers,
          entryFee
        }
      });

      logger.info(`✅ User ${userId} joined queue successfully`);

      // Start timeout timer
      this.startQueueTimeoutTimer(userId, gameType, maxPlayers, entryFee);
      
      // Trigger immediate matchmaking check
      setTimeout(() => this.processMatchmaking(), 500);

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

  async leaveQueue(userId) {
    try {
      const deletedCount = await prisma.matchmakingQueue.deleteMany({
        where: { userId }
      });
      
      this.clearAllTimeoutTimersForUser(userId);
      
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

  async processMatchmaking() {
    if (this.isProcessingMatchmaking) {
      return;
    }

    this.isProcessingMatchmaking = true;
    
    try {
      logger.info('🔄 Processing optimized matchmaking...');
      
      // PRIORITY 1: INSTANT REAL USER MATCHING
      const realUserGamesCreated = await this.matchRealUsersInstantly();
      
      if (realUserGamesCreated > 0) {
        logger.info(`⚡ INSTANT MATCH: Created ${realUserGamesCreated} games with real users!`);
        return;
      }
      
      // PRIORITY 2: MIXED MATCHING (30+ second wait)
      const mixedGamesCreated = await this.matchWithBotsAfterWait();
      
      if (mixedGamesCreated > 0) {
        logger.info(`🤖 MIXED MATCH: Created ${mixedGamesCreated} games with bots`);
      }
      
    } catch (error) {
      logger.error('Matchmaking error:', error);
    } finally {
      this.isProcessingMatchmaking = false;
    }
  }

  // PRIORITY 1: Match real users together immediately
  async matchRealUsersInstantly() {
    try {
      const realUserGroups = await prisma.matchmakingQueue.groupBy({
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

      let gamesCreated = 0;
      
      for (const group of realUserGroups) {
        const { gameType, maxPlayers, entryFee } = group;
        const realUsersCount = group._count.id;

        if (realUsersCount >= maxPlayers) {
          logger.info(`🎯 INSTANT MATCH AVAILABLE: ${realUsersCount} real users for ${gameType} ${maxPlayers}P`);
          
          const possibleGames = Math.floor(realUsersCount / maxPlayers);
          
          for (let i = 0; i < possibleGames; i++) {
            try {
              const game = await this.createGame(gameType, maxPlayers, entryFee);
              if (game) {
                gamesCreated++;
                logger.info(`⚡ CREATED INSTANT GAME: ${game.id} with ${maxPlayers} real players!`);
              } else {
                break;
              }
            } catch (error) {
              logger.error(`Failed to create instant game:`, error);
              break;
            }
          }
        }
      }
      
      return gamesCreated;
    } catch (error) {
      logger.error('Error in instant real user matching:', error);
      return 0;
    }
  }

  // PRIORITY 2: Match real users with bots after 30 seconds
  async matchWithBotsAfterWait() {
    try {
      // Find real users who have waited 30+ seconds
      const waitingUsers = await prisma.matchmakingQueue.findMany({
        where: {
          user: { isBot: false },
          createdAt: {
            lte: new Date(Date.now() - 30000) // 30 seconds ago
          }
        },
        include: { user: true },
        orderBy: { createdAt: 'asc' }
      });

      if (waitingUsers.length === 0) {
        return 0;
      }

      logger.info(`⏰ Found ${waitingUsers.length} real users waiting 30+ seconds`);

      let gamesCreated = 0;

      // Group by game configuration
      const usersByConfig = new Map();
      waitingUsers.forEach(user => {
        const key = `${user.gameType}_${user.maxPlayers}_${user.entryFee}`;
        if (!usersByConfig.has(key)) {
          usersByConfig.set(key, []);
        }
        usersByConfig.get(key).push(user);
      });

      // Process each configuration
      for (const [configKey, users] of usersByConfig) {
        const [gameType, maxPlayers, entryFee] = configKey.split('_');
        const maxPlayersNum = parseInt(maxPlayers);
        const entryFeeNum = parseFloat(entryFee);

        logger.info(`🤖 Processing ${users.length} waiting users for ${gameType} ${maxPlayersNum}P`);

        // Add bots to fill the game
        const botsNeeded = maxPlayersNum - users.length;
        
        if (botsNeeded > 0) {
          for (let i = 0; i < botsNeeded; i++) {
            try {
              const botUser = await this.getOptimalBot(users[0].userId, gameType, entryFeeNum, maxPlayersNum);
              
              await prisma.matchmakingQueue.create({
                data: {
                  userId: botUser.id,
                  gameType,
                  maxPlayers: maxPlayersNum,
                  entryFee: entryFeeNum
                }
              });
              
              logger.info(`🤖 Added bot ${botUser.name} for waiting users`);
            } catch (error) {
              logger.error(`Failed to add bot:`, error);
            }
          }
        }

        // Create the game
        try {
          const game = await this.createGame(gameType, maxPlayersNum, entryFeeNum);
          if (game) {
            gamesCreated++;
            logger.info(`🎮 CREATED MIXED GAME: ${game.id} (${users.length} real + ${botsNeeded} bots)`);
          }
        } catch (error) {
          logger.error(`Failed to create mixed game:`, error);
        }
      }

      return gamesCreated;
    } catch (error) {
      logger.error('Error in bot matching:', error);
      return 0;
    }
  }

  async createGame(gameType, playersToMatch, entryFee) {
    try {
      logger.info(`🎮 Creating game: ${gameType} ${playersToMatch}P ₹${entryFee}`);
      
      const result = await prisma.$transaction(async (tx) => {
        // Get players from queue
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

        // Calculate prize pool
        const totalEntryFees = entryFee * playersToMatch;
        const prizePool = totalEntryFees * 0.8;

        // Initialize game data
        let initialGameData = {};
        if (gameType === 'MEMORY') {
          initialGameData = gameService.initializeMemoryGameBoard();
        }

        // Create game
        const game = await tx.game.create({
          data: {
            type: gameType,
            maxPlayers: playersToMatch,
            entryFee,
            prizePool,
            status: 'WAITING',
            gameData: initialGameData,
          }
        });

        // Remove players from queue
        const queueIds = queueEntries.map(entry => entry.id);
        await tx.matchmakingQueue.deleteMany({
          where: { id: { in: queueIds } }
        });

        // Process entry fees and create participations
        const participations = [];
        const colors = ['red', 'blue', 'green', 'yellow'];
        const processedUsers = new Set();

        for (let i = 0; i < queueEntries.length; i++) {
          const queueEntry = queueEntries[i];
          
          if (processedUsers.has(queueEntry.userId)) {
            continue;
          }
          processedUsers.add(queueEntry.userId);

          // Deduct entry fee for paid games
          if (entryFee > 0) {
            const deductionResult = await walletService.deductGameEntry(queueEntry.userId, entryFee, game.id);
            if (!deductionResult.success) {
              throw new Error(`Failed to deduct entry fee from user ${queueEntry.userId}`);
            }
          }

          // Create participation
          const participation = await tx.gameParticipation.create({
            data: {
              userId: queueEntry.userId,
              gameId: game.id,
              position: i,
              color: colors[i % colors.length],
              score: 0
            }
          });
          participations.push(participation);
        }

        // Get game with participants
        const gameWithParticipants = await tx.game.findUnique({
          where: { id: game.id },
          include: { participants: true }
        });

        return { game: gameWithParticipants, players: queueEntries.map(q => q.user) };
      });

      // Clear timeout timers for all players
      result.players.forEach(player => {
        this.clearAllTimeoutTimersForUser(player.id);
      });

      // Notify callback
      if (this.onGameCreatedCallback) {
        this.onGameCreatedCallback(result.game, result.players);
      }

      return result.game;
    } catch (error) {
      logger.error('Create game error:', error);
      if (error.message.includes('Insufficient players')) {
        return null;
      }
      throw error;
    }
  }

  async getOptimalBot(userId, gameType, entryFee, maxPlayers) {
    try {
      // Get recent bot opponents
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
        take: 5 // Last 5 games
      });

      // Get recent bot IDs
      const recentBotIds = new Set();
      recentGames.forEach(participation => {
        participation.game.participants.forEach(participant => {
          if (participant.user.isBot && participant.userId !== userId) {
            recentBotIds.add(participant.userId);
          }
        });
      });

      // Find available unused bots
      const availableBots = await prisma.user.findMany({
        where: {
          isBot: true,
          id: { notIn: Array.from(recentBotIds) },
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

      let selectedBot;
      if (availableBots.length > 0) {
        selectedBot = availableBots[Math.floor(Math.random() * availableBots.length)];
        logger.info(`Selected unused bot: ${selectedBot.name}`);
      } else {
        logger.info(`No unused bots available, creating new bot`);
        selectedBot = await botService.createBotUser();
      }

      // Ensure bot has sufficient balance
      if (entryFee > 0) {
        const currentWallet = await prisma.wallet.findUnique({
          where: { userId: selectedBot.id }
        });
        
        if (!currentWallet || currentWallet.gameBalance < entryFee) {
          const amountToAdd = Math.max(1000, entryFee * 10);
          
          await prisma.wallet.upsert({
            where: { userId: selectedBot.id },
            update: {
              gameBalance: { increment: amountToAdd },
              balance: { increment: amountToAdd }
            },
            create: {
              userId: selectedBot.id,
              balance: amountToAdd,
              gameBalance: amountToAdd,
              withdrawableBalance: 0
            }
          });
        }
      }

      return selectedBot;
    } catch (error) {
      logger.error('Error getting optimal bot:', error);
      return await botService.getBotForMatchmaking(gameType, entryFee, maxPlayers);
    }
  }

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
    }, 120000); // 2 minutes

    this.queueTimeoutTimers.set(timeoutKey, timer);
  }

  async handleQueueTimeout(userId, gameType, maxPlayers, entryFee) {
    try {
      const queueEntry = await prisma.matchmakingQueue.findFirst({
        where: { userId, gameType, maxPlayers, entryFee }
      });

      if (!queueEntry) {
        return;
      }

      logger.info(`⏰ Queue timeout for user ${userId}`);

      // Remove from queue
      await prisma.matchmakingQueue.deleteMany({
        where: { userId }
      });

      // Refund if paid game
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

      // Notify via callback
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

module.exports = new OptimizedMatchmakingService();