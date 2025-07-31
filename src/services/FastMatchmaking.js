const prisma = require('../config/database');
const logger = require('../config/logger');
const walletService = require('./walletService');
const gameService = require('./gameService');
const botService = require('./BotService');

class FastMatchmakingService {
  constructor() {
    this.matchmakingInterval = null;
    this.onGameCreatedCallback = null;
    this.initialized = false;
    this.isProcessingMatchmaking = false;
    this.queueTimeoutTimers = new Map();
  }

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

  startMatchmaking() {
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
    }
    this.matchmakingInterval = setInterval(() => {
      this.processMatchmaking();
    }, 1000); // Reduced to 1 second for more responsive matchmaking
    logger.info('🚀 Fast matchmaking started - checking every 1 second');
  }

  stop() {
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
      this.matchmakingInterval = null;
    }
    
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

      // Deduct entry fee immediately when joining queue (not when game is created)
      if (entryFee > 0) {
        const deductionResult = await walletService.deductGameEntry(userId, entryFee, `queue_${userId}_${Date.now()}`);
        if (!deductionResult.success) {
          logger.error(`Failed to deduct entry fee from user ${userId}: ${deductionResult.message}`);
          throw new Error(deductionResult.message || 'Failed to deduct entry fee');
        }
        logger.info(`✅ Entry fee ₹${entryFee} deducted from user ${userId} for joining queue`);
      }

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
      // Get queue entries before deleting to check for refunds
      const queueEntries = await prisma.matchmakingQueue.findMany({
        where: { userId }
      });
      
      const deletedCount = await prisma.matchmakingQueue.deleteMany({
        where: { userId }
      });
      
      this.clearAllTimeoutTimersForUser(userId);
      
      // Refund entry fees for manually leaving queue
      for (const queueEntry of queueEntries) {
        if (queueEntry.entryFee > 0) {
          try {
            await walletService.creditWallet(
              userId,
              queueEntry.entryFee,
              'REFUND',
              null,
              'Manual queue exit refund'
            );
            logger.info(`💰 Refunded ₹${queueEntry.entryFee} to user ${userId} for leaving queue`);
          } catch (refundError) {
            logger.error(`Failed to refund user ${userId} for leaving queue:`, refundError);
          }
        }
      }
      
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
      logger.info('🔄 Processing fast matchmaking...');
      
      // PRIORITY 1: INSTANT REAL USER MATCHING (0 seconds wait)
      const realUserGamesCreated = await this.matchRealUsersInstantly();
      
      if (realUserGamesCreated > 0) {
        logger.info(`⚡ INSTANT MATCH: Created ${realUserGamesCreated} games with real users!`);
        return;
      }
      
      // PRIORITY 2: BOT DEPLOYMENT AFTER 15 SECONDS
      const botGamesAfter15s = await this.deployBotsAfter15Seconds();
      
      if (botGamesAfter15s > 0) {
        logger.info(`🤖 15s BOT MATCH: Created ${botGamesAfter15s} games with bots after 15s wait`);
        return;
      }
      
      // PRIORITY 3: REAL USER MATCHING AGAIN (15-30 seconds)
      const realUserGamesAfter15s = await this.matchRealUsersAfter15Seconds();
      
      if (realUserGamesAfter15s > 0) {
        logger.info(`⚡ 15s+ REAL USER MATCH: Created ${realUserGamesAfter15s} games with real users!`);
        return;
      }
      
      // PRIORITY 4: GUARANTEED BOT DEPLOYMENT AFTER 30 SECONDS
      const guaranteedBotGames = await this.guaranteedBotDeploymentAfter30Seconds();
      
      if (guaranteedBotGames > 0) {
        logger.info(`🤖 30s GUARANTEED BOT: Created ${guaranteedBotGames} games with guaranteed bots`);
      }
      
    } catch (error) {
      logger.error('Matchmaking error:', error);
    } finally {
      this.isProcessingMatchmaking = false;
    }
  }

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
              const game = await this.createGameFast(gameType, maxPlayers, entryFee);
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

  // NEW METHOD: Deploy bots after 5 seconds of waiting (reduced for testing)
  async deployBotsAfter15Seconds() {
    try {
      // Find users waiting exactly 4+ seconds but less than 30 seconds (reduced for testing)
      const usersWaiting15s = await prisma.matchmakingQueue.findMany({
        where: {
          user: { isBot: false },
          createdAt: {
            lte: new Date(Date.now() - 4000), // 4 seconds ago (reduced for testing)
            gte: new Date(Date.now() - 30000)  // but not more than 30 seconds
          }
        },
        include: { user: true },
        orderBy: { createdAt: 'asc' }
      });

      if (usersWaiting15s.length === 0) {
        return 0;
      }

      // Double-check that users have actually been waiting at least 4 seconds
      const validUsers = usersWaiting15s.filter(user => {
        const waitTime = Date.now() - user.createdAt.getTime();
        return waitTime >= 4000; // At least 4 seconds (reduced for testing)
      });

      if (validUsers.length === 0) {
        return 0;
      }

      logger.info(`🤖 BOT DEPLOYMENT: Found ${validUsers.length} users waiting 4+ seconds - INITIATING BOT DEPLOYMENT`);
      validUsers.forEach(user => {
        const waitTime = Math.floor((Date.now() - user.createdAt.getTime()) / 1000);
        logger.info(`🤖 BOT DEPLOYMENT: User ${user.user.name} waiting ${waitTime}s for ${user.gameType} ${user.maxPlayers}P ₹${user.entryFee}`);
      });

      let gamesCreated = 0;
      const usersByConfig = new Map();
      
      // Group users by game configuration
      usersWaiting15s.forEach(user => {
        const key = `${user.gameType}_${user.maxPlayers}_${user.entryFee}`;
        if (!usersByConfig.has(key)) {
          usersByConfig.set(key, []);
        }
        usersByConfig.get(key).push(user);
      });

      // Deploy bots for each configuration
      for (const [configKey, users] of usersByConfig) {
        const [gameType, maxPlayers, entryFee] = configKey.split('_');
        const maxPlayersNum = parseInt(maxPlayers);
        const entryFeeNum = parseFloat(entryFee);

        // Check if bots are available for deployment
        const availableBotsCount = await botService.getAvailableBotsCount();
        if (availableBotsCount === 0) {
          logger.info(`🤖 No available bots for ${configKey}, creating new bots`);
          await botService.ensureMinimumBots(5);
        }

        // Deploy bots for this configuration
        const botsNeeded = maxPlayersNum - users.length;
        if (botsNeeded > 0) {
          logger.info(`🤖 BOT DEPLOYMENT: DEPLOYING ${botsNeeded} bots for ${users.length} users waiting 5s for ${configKey}`);
          
          for (let i = 0; i < botsNeeded; i++) {
            try {
              logger.info(`🤖 BOT DEPLOYMENT: Deploying bot ${i + 1}/${botsNeeded}...`);
              const deployedBot = await this.deploySingleBot(users[0].userId, gameType, entryFeeNum, maxPlayersNum);
              logger.info(`🤖 BOT DEPLOYMENT: Successfully deployed bot ${deployedBot.name} (${deployedBot.id})`);
            } catch (error) {
              logger.error(`🤖 BOT DEPLOYMENT: Failed to deploy bot ${i + 1}/${botsNeeded}:`, error);
            }
          }

          // Try to create game after bot deployment
          const finalQueueCount = await prisma.matchmakingQueue.count({
            where: {
              gameType,
              maxPlayers: maxPlayersNum,
              entryFee: entryFeeNum
            }
          });

          if (finalQueueCount >= maxPlayersNum) {
            try {
              const game = await this.createGameFast(gameType, maxPlayersNum, entryFeeNum);
              if (game) {
                gamesCreated++;
                logger.info(`🎮 BOT DEPLOYMENT: ✅ GAME CREATED SUCCESSFULLY: ${game.id} with ${finalQueueCount} players`);
              }
            } catch (error) {
              logger.error(`Failed to create 15s bot game:`, error);
            }
          }
        }
      }

      return gamesCreated;
    } catch (error) {
      logger.error('Error in 15s bot deployment:', error);
      return 0;
    }
  }

  // NEW METHOD: Match real users again after 15 seconds (15-30 second window)
  async matchRealUsersAfter15Seconds() {
    try {
      // Find real users waiting 15-30 seconds
      const realUsersWaiting = await prisma.matchmakingQueue.findMany({
        where: {
          user: { isBot: false },
          createdAt: {
            lte: new Date(Date.now() - 15000), // 15 seconds ago
            gte: new Date(Date.now() - 30000)  // but not more than 30 seconds
          }
        },
        include: { user: true },
        orderBy: { createdAt: 'asc' }
      });

      if (realUsersWaiting.length < 2) {
        return 0;
      }

      logger.info(`⚡ Found ${realUsersWaiting.length} real users waiting 15-30s - attempting real user matching`);

      // Group by game configuration and check if we can match real users
      const realUserGroups = await prisma.matchmakingQueue.groupBy({
        by: ['gameType', 'maxPlayers', 'entryFee'],
        _count: { id: true },
        where: {
          user: { isBot: false },
          createdAt: {
            lte: new Date(Date.now() - 15000),
            gte: new Date(Date.now() - 30000)
          }
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
          logger.info(`⚡ 15s+ REAL USER MATCH: ${realUsersCount} real users for ${gameType} ${maxPlayers}P`);
          
          const possibleGames = Math.floor(realUsersCount / maxPlayers);
          
          for (let i = 0; i < possibleGames; i++) {
            try {
              const game = await this.createGameFast(gameType, maxPlayers, entryFee);
              if (game) {
                gamesCreated++;
                logger.info(`⚡ CREATED 15s+ REAL USER GAME: ${game.id} with ${maxPlayers} real players!`);
              } else {
                break;
              }
            } catch (error) {
              logger.error(`Failed to create 15s+ real user game:`, error);
              break;
            }
          }
        }
      }
      
      return gamesCreated;
    } catch (error) {
      logger.error('Error in 15s+ real user matching:', error);
      return 0;
    }
  }

  // NEW METHOD: Guaranteed bot deployment after 30 seconds
  async guaranteedBotDeploymentAfter30Seconds() {
    try {
      // Find users waiting 30+ seconds
      const usersWaiting30s = await prisma.matchmakingQueue.findMany({
        where: {
          user: { isBot: false },
          createdAt: {
            lte: new Date(Date.now() - 30000) // 30+ seconds ago
          }
        },
        include: { user: true },
        orderBy: { createdAt: 'asc' }
      });

      if (usersWaiting30s.length === 0) {
        return 0;
      }

      logger.info(`🚨 GUARANTEED BOT DEPLOYMENT: ${usersWaiting30s.length} users waiting 30+ seconds`);

      let gamesCreated = 0;
      const usersByConfig = new Map();
      
      // Group users by game configuration
      usersWaiting30s.forEach(user => {
        const key = `${user.gameType}_${user.maxPlayers}_${user.entryFee}`;
        if (!usersByConfig.has(key)) {
          usersByConfig.set(key, []);
        }
        usersByConfig.get(key).push(user);
      });

      // GUARANTEED bot deployment for each configuration
      for (const [configKey, users] of usersByConfig) {
        const [gameType, maxPlayers, entryFee] = configKey.split('_');
        const maxPlayersNum = parseInt(maxPlayers);
        const entryFeeNum = parseFloat(entryFee);

        logger.info(`🚨 GUARANTEED: Processing ${users.length} users waiting 30+ seconds for ${configKey}`);

        // Ensure we have enough bots available
        await botService.ensureMinimumBots(10);

        // Deploy bots to fill the game - GUARANTEED
        const botsNeeded = maxPlayersNum - users.length;
        if (botsNeeded > 0) {
          logger.info(`🚨 GUARANTEED: Deploying ${botsNeeded} bots immediately for ${configKey}`);
          
          // Deploy bots in parallel for fastest deployment
          const botPromises = [];
          for (let i = 0; i < botsNeeded; i++) {
            botPromises.push(this.deploySingleBot(users[0].userId, gameType, entryFeeNum, maxPlayersNum));
          }

          try {
            await Promise.all(botPromises);
            logger.info(`🚨 GUARANTEED: Successfully deployed ${botsNeeded} bots`);
          } catch (error) {
            logger.error(`🚨 GUARANTEED: Error deploying bots:`, error);
            // Try individual deployment as fallback
            for (let i = 0; i < botsNeeded; i++) {
              try {
                await this.deploySingleBot(users[0].userId, gameType, entryFeeNum, maxPlayersNum);
              } catch (individualError) {
                logger.error(`🚨 GUARANTEED: Individual bot deployment failed:`, individualError);
              }
            }
          }
        }

        // GUARANTEED game creation after 30 seconds
        try {
          const game = await this.createGameFast(gameType, maxPlayersNum, entryFeeNum);
          if (game) {
            gamesCreated++;
            logger.info(`🚨 GUARANTEED GAME CREATED: ${game.id} after 30s wait`);
          } else {
            logger.error(`🚨 GUARANTEED: Failed to create game for ${configKey} - this should never happen!`);
          }
        } catch (error) {
          logger.error(`🚨 GUARANTEED: Critical error creating game for ${configKey}:`, error);
        }
      }

      return gamesCreated;
    } catch (error) {
      logger.error('🚨 GUARANTEED: Critical error in 30s bot deployment:', error);
      return 0;
    }
  }

  async deployBotsForUsers(waitingUsers, isUrgent = false) {
    let gamesCreated = 0;

    const usersByConfig = new Map();
    waitingUsers.forEach(user => {
      const key = `${user.gameType}_${user.maxPlayers}_${user.entryFee}`;
      if (!usersByConfig.has(key)) {
        usersByConfig.set(key, []);
      }
      usersByConfig.get(key).push(user);
    });

    for (const [configKey, users] of usersByConfig) {
      const [gameType, maxPlayers, entryFee] = configKey.split('_');
      const maxPlayersNum = parseInt(maxPlayers);
      const entryFeeNum = parseFloat(entryFee);

      const urgencyLabel = isUrgent ? 'URGENT' : 'STANDARD';
      logger.info(`🤖 ${urgencyLabel}: Processing ${users.length} waiting users for ${gameType} ${maxPlayersNum}P ₹${entryFeeNum}`);

      // Check current queue status
      const currentQueueEntries = await prisma.matchmakingQueue.findMany({
        where: {
          gameType,
          maxPlayers: maxPlayersNum,
          entryFee: entryFeeNum
        },
        include: { user: true }
      });

      const realUsersInQueue = currentQueueEntries.filter(entry => !entry.user.isBot).length;
      const botsInQueue = currentQueueEntries.filter(entry => entry.user.isBot).length;
      const totalInQueue = currentQueueEntries.length;

      logger.info(`🤖 Current queue: ${realUsersInQueue} real users, ${botsInQueue} bots, ${totalInQueue} total`);

      const botsNeeded = Math.max(0, maxPlayersNum - totalInQueue);
      
      if (botsNeeded > 0) {
        logger.info(`🤖 ${urgencyLabel}: Deploying ${botsNeeded} bots immediately`);
        
        // Deploy bots in parallel for faster deployment
        const botPromises = [];
        for (let i = 0; i < botsNeeded; i++) {
          botPromises.push(this.deploySingleBot(users[0].userId, gameType, entryFeeNum, maxPlayersNum));
        }

        const deployedBots = await Promise.allSettled(botPromises);
        const successfulDeployments = deployedBots.filter(result => result.status === 'fulfilled').length;
        
        logger.info(`🤖 ${urgencyLabel}: Successfully deployed ${successfulDeployments}/${botsNeeded} bots`);
      }

      // Check if we can create a game now
      const finalQueueCount = await prisma.matchmakingQueue.count({
        where: {
          gameType,
          maxPlayers: maxPlayersNum,
          entryFee: entryFeeNum
        }
      });

      if (finalQueueCount >= maxPlayersNum) {
        try {
          const game = await this.createGameFast(gameType, maxPlayersNum, entryFeeNum);
          if (game) {
            gamesCreated++;
            logger.info(`🎮 ${urgencyLabel}: CREATED GAME: ${game.id} with ${finalQueueCount} players`);
          }
        } catch (error) {
          logger.error(`❌ Failed to create ${urgencyLabel.toLowerCase()} game for ${gameType}:`, error);
        }
      } else {
        logger.warn(`⚠️ ${urgencyLabel}: Still need more players: ${finalQueueCount}/${maxPlayersNum}`);
      }
    }

    return gamesCreated;
  }

  async deploySingleBot(userId, gameType, entryFee, maxPlayers) {
    try {
      logger.info(`🤖 SINGLE BOT DEPLOY: Starting deployment for user ${userId}, game: ${gameType} ${maxPlayers}P ₹${entryFee}`);
      
      const botUser = await this.getOptimalBot(userId, gameType, entryFee, maxPlayers);
      logger.info(`🤖 SINGLE BOT DEPLOY: Got optimal bot ${botUser.name} (${botUser.id})`);
      
      // Check if bot is already in this specific queue
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
        
        logger.info(`✅ SINGLE BOT DEPLOY: Bot ${botUser.name} (${botUser.id}) successfully deployed to queue`);
        return botUser;
      } else {
        logger.info(`⚠️ SINGLE BOT DEPLOY: Bot ${botUser.name} already in queue, creating different bot...`);
        // Try to get a different bot
        const differentBot = await botService.createBotUser();
        logger.info(`🤖 SINGLE BOT DEPLOY: Created new bot ${differentBot.name} (${differentBot.id})`);
        
        await prisma.matchmakingQueue.create({
          data: {
            userId: differentBot.id,
            gameType,
            maxPlayers,
            entryFee
          }
        });
        logger.info(`✅ SINGLE BOT DEPLOY: New bot ${differentBot.name} successfully deployed to queue`);
        return differentBot;
      }
    } catch (error) {
      logger.error(`❌ SINGLE BOT DEPLOY: Failed to deploy single bot:`, error);
      throw error;
    }
  }

  // OPTIMIZED FAST GAME CREATION
  async createGameFast(gameType, playersToMatch, entryFee) {
    try {
      logger.info(`🎮 Creating game: ${gameType} ${playersToMatch}P ₹${entryFee}`);
      
      // Step 1: Get players and remove from queue (fast transaction)
      const { queueEntries, gameId } = await prisma.$transaction(async (tx) => {
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

        // Create game (minimal data)
        const game = await tx.game.create({
          data: {
            type: gameType,
            maxPlayers: playersToMatch,
            entryFee,
            prizePool,
            status: 'WAITING',
            gameData: {}, // Initialize empty, update later
          }
        });

        // Remove players from queue immediately
        const queueIds = queueEntries.map(entry => entry.id);
        await tx.matchmakingQueue.deleteMany({
          where: { id: { in: queueIds } }
        });

        return { queueEntries, gameId: game.id };
      }, {
        timeout: 10000, // 10 second timeout
      });

      // Step 2: Create participations and update game data (separate transaction)
      // Note: Wallet deduction already happened when users joined the queue
      const finalGame = await prisma.$transaction(async (tx) => {
        // Create participations in batch
        const participationData = [];
        const colors = ['red', 'blue', 'green', 'yellow'];

        for (let i = 0; i < queueEntries.length; i++) {
          const queueEntry = queueEntries[i];
          participationData.push({
            userId: queueEntry.userId,
            gameId: gameId,
            position: i,
            color: colors[i % colors.length],
            score: 0
          });
        }

        await tx.gameParticipation.createMany({
          data: participationData
        });

        // Initialize game data if needed
        let gameData = {};
        if (gameType === 'MEMORY') {
          gameData = gameService.initializeMemoryGameBoard();
        }

        // Update game with proper data
        const updatedGame = await tx.game.update({
          where: { id: gameId },
          data: { gameData },
          include: { participants: true }
        });

        return updatedGame;
      }, {
        timeout: 10000,
      });

      // Clear timeout timers for all players
      queueEntries.forEach(entry => {
        this.clearAllTimeoutTimersForUser(entry.userId);
      });

      // Notify callback
      if (this.onGameCreatedCallback) {
        this.onGameCreatedCallback(finalGame, queueEntries.map(q => q.user));
      }

      return finalGame;
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
      // First ensure we have minimum bots available
      await botService.ensureMinimumBots(15);
      
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
        logger.info(`🤖 Selected existing bot: ${selectedBot.name} from ${availableBots.length} available`);
      } else {
        logger.info(`🤖 No available bots found, creating new bot`);
        selectedBot = await botService.createBotUser();
      }

      // Ensure bot has sufficient balance
      if (entryFee > 0) {
        const currentWallet = await prisma.wallet.findUnique({
          where: { userId: selectedBot.id }
        });
        
        if (!currentWallet || currentWallet.gameBalance < entryFee) {
          const amountToAdd = Math.max(1000, entryFee * 10);
          
          logger.info(`🤖 Adding ₹${amountToAdd} to bot ${selectedBot.name} wallet`);
          
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
      
      // Fallback: try to get any bot from BotService
      try {
        return await botService.getBotForMatchmaking(gameType, entryFee, maxPlayers);
      } catch (fallbackError) {
        logger.error('Fallback bot creation also failed:', fallbackError);
        throw fallbackError;
      }
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
    }, 120000);

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

      await prisma.matchmakingQueue.deleteMany({
        where: { userId }
      });

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

module.exports = new FastMatchmakingService();