const prisma = require('../config/database');
const logger = require('../config/logger');
const walletService = require('./walletService');
const gameService = require('./gameService'); // For initializing game board based on game type
const botService = require('./BotService'); // For bot players

class MatchmakingService {
  constructor() {
    this.matchmakingInterval = null;
    this.onGameCreatedCallback = null; // Callback to notify server.js
    this.initialized = false;
    this.botDeploymentTimers = new Map(); // Track bot deployment timers for each queue
    this.isProcessingMatchmaking = false; // Prevent concurrent matchmaking cycles
    this.queueTimeoutTimers = new Map(); // Track 2-minute timeout timers for refunds
    this.userBotHistory = new Map(); // Track which bots each user has played against
  }

  async initialize() {
    if (this.initialized) {
      logger.info('MatchmakingService already initialized');
      return;
    }
    
    try {
      this.startMatchmaking();
      this.initialized = true;
      logger.info('MatchmakingService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize MatchmakingService:', error);
      throw error;
    }
  }

  startMatchmaking() {
    // Run matchmaking every 5 seconds for faster matching
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
    }
    this.matchmakingInterval = setInterval(() => {
      this.processMatchmaking();
    }, 1000);
    logger.info('Matchmaking interval started, running every 1 second for real-time matching.');
  }

  stop() {
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
      this.matchmakingInterval = null;
      logger.info('Matchmaking interval stopped.');
    }
    
    // Clear all bot deployment timers
    for (const [queueKey, timer] of this.botDeploymentTimers.entries()) {
      clearTimeout(timer);
      logger.info(`Cleared bot deployment timer for queue: ${queueKey}`);
    }
    this.botDeploymentTimers.clear();
    
    // Clear all queue timeout timers
    for (const [timeoutKey, timer] of this.queueTimeoutTimers.entries()) {
      clearTimeout(timer);
      logger.info(`Cleared queue timeout timer: ${timeoutKey}`);
    }
    this.queueTimeoutTimers.clear();
  }

  setGameCreatedCallback(callback) {
    this.onGameCreatedCallback = callback;
  }

  async joinQueue(userId, gameType, maxPlayers, entryFee) {
    try {
      logger.info(`User ${userId} attempting to join queue: ${gameType} - ${maxPlayers}P - ₹${entryFee}`);
      
      // Check if user has sufficient balance (skip for free games)
      if (entryFee > 0) {
        const walletBalance = await walletService.getWalletBalance(userId);
        const totalBalance = (walletBalance.gameBalance || 0) + (walletBalance.withdrawableBalance || 0);
        logger.info(`User ${userId} total balance: ₹${totalBalance} (Game: ₹${walletBalance.gameBalance}, Withdrawable: ₹${walletBalance.withdrawableBalance}), required: ₹${entryFee}`);
        if (totalBalance < entryFee) {
          logger.warn(`Insufficient balance for user ${userId} to join queue. Has: ₹${totalBalance}, Needs: ₹${entryFee}`);
          throw new Error('Insufficient balance');
        }
      } else {
        logger.info(`Free game - skipping balance check for user ${userId}`);
      }

      // Check if user is already in queue for the same game configuration
      const existingQueue = await prisma.matchmakingQueue.findFirst({
        where: { 
          userId,
          gameType,
          maxPlayers,
          entryFee
        }
      });

      if (existingQueue) {
        logger.info(`User ${userId} already in queue for ${gameType} ${maxPlayers}P ₹${entryFee} (ID: ${existingQueue.id}) - skipping duplicate join`);
        return {
          success: true,
          message: 'Already in matchmaking queue for this game',
          queueId: existingQueue.id
        };
      }

      // Check if user is in any other queue and remove them
      const otherQueues = await prisma.matchmakingQueue.findMany({
        where: { userId }
      });

      if (otherQueues.length > 0) {
        logger.info(`User ${userId} found in ${otherQueues.length} other queue(s) - removing before adding to new queue`);
        await prisma.matchmakingQueue.deleteMany({
          where: { userId }
        });
        
        // Clear any existing timeout timers for this user
        this.clearAllTimeoutTimersForUser(userId);
      }

      // Add to queue
      const queueEntry = await prisma.matchmakingQueue.create({
        data: {
          userId,
          gameType,
          maxPlayers,
          entryFee
        }
      });

      logger.info(`User ${userId} successfully joined matchmaking queue (ID: ${queueEntry.id}) for ${gameType} ${maxPlayers}P game.`);

      // Start bot deployment timer for this queue configuration (30 seconds)
      this.startBotDeploymentTimer(gameType, maxPlayers, entryFee);
      
      // Start 2-minute timeout timer for refund
      this.startQueueTimeoutTimer(userId, gameType, maxPlayers, entryFee);

        // Trigger immediate matchmaking check for real users
        setTimeout(() => {
          this.processMatchmaking();
        }, 100);

      return {
        success: true,
        message: 'Joined matchmaking queue',
        queueId: queueEntry.id
      };
    } catch (error) {
      logger.error(`Join queue error for user ${userId}:`, error);
      throw error; // Re-throw for API/socket handler to catch
    }
  }

  async leaveQueue(userId) {
    try {
      const deletedCount = await prisma.matchmakingQueue.deleteMany({
        where: { userId }
      });
      
      // Clear timeout timers for this user
      this.clearAllTimeoutTimersForUser(userId);
      
      if (deletedCount.count > 0) {
        logger.info(`User ${userId} successfully left matchmaking queue. Removed ${deletedCount.count} entries.`);
      } else {
        logger.info(`User ${userId} was not in any matchmaking queue.`);
      }

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
    // Prevent concurrent matchmaking cycles
    if (this.isProcessingMatchmaking) {
      logger.info('Matchmaking cycle already in progress, skipping...');
      return;
    }

    this.isProcessingMatchmaking = true;
    
    try {
      logger.info(' Processing matchmaking cycle...');
      
      // PRIORITY 1: Check for real user matches first (within 30 seconds)
      const realUserGamesCreated = await this.matchRealUsersImmediately();
      
      if (realUserGamesCreated > 0) {
        logger.info(`✅ REAL USER PRIORITY: Created ${realUserGamesCreated} games with real users only!`);
        // Schedule next cycle immediately if real user games were created
        setTimeout(() => this.processMatchmaking(), 1000);
        return;
      }
      
      // PRIORITY 2: Check for mixed matches (real users + bots) after 30 seconds
      const mixedGamesCreated = await this.matchRealUsersWithBots();
      
      if (mixedGamesCreated > 0) {
        logger.info(`✅ MIXED MATCHING: Created ${mixedGamesCreated} games with real users and bots`);
        // Schedule next cycle immediately if games were created
        setTimeout(() => this.processMatchmaking(), 1000);
      } else {
        logger.info('Matchmaking cycle completed. No new games created in this cycle.');
      }
    } catch (error) {
      logger.error('Process matchmaking error:', error);
    } finally {
      this.isProcessingMatchmaking = false;
    }
  }

  async createGame(gameType, playersToMatch, entryFee) {
    try {
      logger.info(`Attempting to create game: Type: ${gameType}, Players: ${playersToMatch}, EntryFee: ₹${entryFee}`);
      
      // Create game and process everything in a single transaction to prevent race conditions
      const result = await prisma.$transaction(async (tx) => {
        // Get exact number of players from queue within the transaction
        const queueEntries = await tx.matchmakingQueue.findMany({
          where: {
            gameType,
            maxPlayers: playersToMatch,
            entryFee
          },
          take: playersToMatch,
          include: {
            user: true
          },
          orderBy: {
            createdAt: 'asc'
          },
          distinct: ['userId']
        });

        if (queueEntries.length < playersToMatch) {
          logger.warn(`Failed to create game: Not enough players found in transaction. Needed: ${playersToMatch}, Found: ${queueEntries.length}.`);
          throw new Error(`Insufficient players: needed ${playersToMatch}, found ${queueEntries.length}`);
        }

        // Calculate prize pool (80% of total entry fees, 20% platform fee)
        const totalEntryFees = entryFee * playersToMatch;
        const prizePool = totalEntryFees * 0.8;
        logger.info(`Calculated prize pool: ₹${prizePool.toFixed(2)} from total entry fees ₹${totalEntryFees.toFixed(2)}.`);

        // Initialize gameData for MemoryGame only
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
        logger.info(`Game ${game.id} created in database with initial status 'WAITING'.`);

        // Remove players from queue first to prevent them being picked up by other processes
        const queueIds = queueEntries.map(entry => entry.id);
        const deletedCount = await tx.matchmakingQueue.deleteMany({
          where: {
            id: { in: queueIds }
          }
        });
        logger.info(`Removed ${deletedCount.count} players from queue for game ${game.id}`);

        // Process entry fees and create participations
        const participations = [];
        const colors = ['red', 'blue', 'green', 'yellow'];
        const processedUsers = new Set();

        for (let i = 0; i < queueEntries.length; i++) {
          const queueEntry = queueEntries[i];
          const playerColor = colors[i % colors.length];

          // Check if we've already processed this user (prevent double deduction)
          if (processedUsers.has(queueEntry.userId)) {
            logger.warn(`User ${queueEntry.userId} already processed for game ${game.id}, skipping duplicate entry`);
            continue;
          }
          processedUsers.add(queueEntry.userId);

          // Deduct entry fee only if not free game and user hasn't been processed
          if (entryFee > 0) {
            try {
              const deductionResult = await walletService.deductGameEntry(queueEntry.userId, entryFee, game.id);
              if (deductionResult.success) {
                logger.info(`Deducted ₹${entryFee} from user ${queueEntry.userId} for game entry. New balance: ₹${deductionResult.gameBalance}`);
              } else {
                logger.error(`Failed to deduct ₹${entryFee} from user ${queueEntry.userId}: ${deductionResult.message}`);
                throw new Error(`Failed to deduct entry fee from user ${queueEntry.userId}: ${deductionResult.message}`);
              }
            } catch (deductionError) {
              logger.error(`Wallet deduction error for user ${queueEntry.userId}:`, deductionError);
              throw new Error(`Wallet deduction failed for user ${queueEntry.userId}: ${deductionError.message}`);
            }
          }

          // Create participation record
          const participation = await tx.gameParticipation.create({
            data: {
              userId: queueEntry.userId,
              gameId: game.id,
              position: i,
              color: playerColor,
              score: 0
            }
          });
          participations.push(participation);
          logger.info(`User ${queueEntry.userId} added as participant for game ${game.id} with color ${playerColor}.`);
        }

        // Fetch the game again with its participants
        const gameWithParticipants = await tx.game.findUnique({
          where: { id: game.id },
          include: { participants: true }
        });

        return { game: gameWithParticipants, participations, players: queueEntries.map(q => q.user) };
      }, {
        maxWait: 10000, // Maximum time to wait for a transaction slot (10 seconds)
        timeout: 20000, // Maximum time for the transaction to run (20 seconds)
      });

      logger.info(`Game ${result.game.id} successfully created and players matched. Notifying via callback.`);

      // Clear bot deployment timer since game was created
      this.clearBotDeploymentTimer(gameType, playersToMatch, entryFee);
      
      // Clear timeout timers for all players in this game
      result.players.forEach(player => {
        this.clearAllTimeoutTimersForUser(player.id);
      });

      // Notify server.js about the created game and matched players
      if (this.onGameCreatedCallback) {
        this.onGameCreatedCallback(result.game, result.players);
      } else {
        logger.warn('No onGameCreatedCallback registered with MatchmakingService.');
      }

      return result.game;
    } catch (error) {
      logger.error('Create game error:', error);
      
      // If it's an insufficient players error, don't treat it as a critical error
      if (error.message.includes('Insufficient players')) {
        logger.info('Not enough players available for game creation, will retry in next cycle');
        return null;
      }
      
      // Re-throw other errors
      throw error; 
    }
  }

  async getQueueStatus(userId) {
    try {
      const queueEntry = await prisma.matchmakingQueue.findFirst({
        where: { userId }
      });

      if (!queueEntry) {
        return {
          inQueue: false,
          message: 'Not in queue'
        };
      }

      // Count players in same queue
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

  // Start bot deployment timer for a specific queue configuration
  startBotDeploymentTimer(gameType, maxPlayers, entryFee) {
    const queueKey = `${gameType}_${maxPlayers}_${entryFee}`;
    
    // Check if there's already a timer for this exact configuration
    const existingTimer = Array.from(this.botDeploymentTimers.keys()).find(key => 
      key.startsWith(queueKey)
    );
    
    if (existingTimer) {
      logger.info(`Bot deployment timer already exists for queue: ${queueKey}`);
      return;
    }
    
    // Generate unique timer key with timestamp
    const uniqueTimerKey = `${queueKey}_${Date.now()}`;
    
    logger.info(`Starting bot deployment timer for queue: ${queueKey} (30 seconds) - Timer ID: ${uniqueTimerKey}`);

    const timer = setTimeout(async () => {
      try {
        logger.info(`Bot deployment timer triggered for: ${queueKey}`);
        await this.deployBotIfNeeded(gameType, maxPlayers, entryFee);
        this.botDeploymentTimers.delete(uniqueTimerKey);
      } catch (error) {
        logger.error(`Error deploying bot for queue ${queueKey}:`, error);
        this.botDeploymentTimers.delete(uniqueTimerKey);
      }
    }, 30000); // 30 seconds as requested

    this.botDeploymentTimers.set(uniqueTimerKey, timer);
  }

  // Deploy a bot if there are waiting players but not enough for a full game
  async deployBotIfNeeded(gameType, maxPlayers, entryFee) {
    try {
      logger.info(`Checking if bot deployment needed for: ${gameType} ${maxPlayers}P ₹${entryFee}`);

      // Check current queue status
      const queueCount = await prisma.matchmakingQueue.count({
        where: {
          gameType,
          maxPlayers,
          entryFee
        }
      });

      logger.info(`Current queue count: ${queueCount}/${maxPlayers} for ${gameType}`);

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
          logger.info(`Deploying bot for ${gameType} game - ${humanPlayersCount} human player(s) waiting`);
          
          try {
            // Get the human player for bot selection
            const humanPlayer = await prisma.matchmakingQueue.findFirst({
              where: {
                gameType,
                maxPlayers,
                entryFee,
                user: { isBot: false }
              },
              include: { user: true }
            });

            // Use new bot rotation logic to ensure variety
            const botUser = await this.getUnusedBotForUser(humanPlayer.userId, gameType, entryFee, maxPlayers);
            logger.info(`Selected unused bot ${botUser.name} for human player ${humanPlayer.user.name}`);
            
            // Add the selected bot to the queue
            await prisma.matchmakingQueue.create({
              data: {
                userId: botUser.id,
                gameType,
                maxPlayers,
                entryFee
              }
            });
            
            logger.info(`Bot ${botUser.name} (${botUser.id}) added to queue for ${gameType} ${maxPlayers}P ₹${entryFee}`);
            
            // Trigger immediate matchmaking check
            setTimeout(() => this.processMatchmaking(), 1000);
          } catch (botError) {
            logger.error(`Failed to deploy bot: ${botError.message}`);
          }
        } else {
          logger.info(`Only bots in queue for ${gameType} ${maxPlayers}P ₹${entryFee} - not deploying additional bot`);
        }
        
      } else if (queueCount === 0) {
        logger.info(`No players in queue for ${gameType} ${maxPlayers}P ₹${entryFee} - bot deployment not needed`);
      } else if (queueCount >= maxPlayers) {
        logger.info(`Enough players (${queueCount}) for ${gameType} ${maxPlayers}P ₹${entryFee} - bot deployment not needed`);
      }

    } catch (error) {
      logger.error(`Error in bot deployment for ${gameType} ${maxPlayers}P ₹${entryFee}:`, error);
    }
  }

  // Clear bot deployment timer when a queue gets enough players
  clearBotDeploymentTimer(gameType, maxPlayers, entryFee) {
    const queueKey = `${gameType}_${maxPlayers}_${entryFee}`;
    
    // Clear all timers for this queue configuration
    const timersToDelete = [];
    for (const [timerKey, timer] of this.botDeploymentTimers.entries()) {
      if (timerKey.startsWith(queueKey)) {
        clearTimeout(timer);
        timersToDelete.push(timerKey);
      }
    }
    
    timersToDelete.forEach(timerKey => {
      this.botDeploymentTimers.delete(timerKey);
      logger.info(`Cleared bot deployment timer: ${timerKey}`);
    });
  }

  // Start 2-minute timeout timer for queue refund
  startQueueTimeoutTimer(userId, gameType, maxPlayers, entryFee) {
    const timeoutKey = `${userId}_${gameType}_${maxPlayers}_${entryFee}`;
    
    // Clear any existing timeout for this user
    if (this.queueTimeoutTimers.has(timeoutKey)) {
      clearTimeout(this.queueTimeoutTimers.get(timeoutKey));
    }
    
    logger.info(`Starting 2-minute timeout timer for user ${userId} in queue: ${gameType} ${maxPlayers}P ₹${entryFee}`);

    const timer = setTimeout(async () => {
      try {
        logger.info(`2-minute timeout triggered for user ${userId} in queue: ${gameType} ${maxPlayers}P ₹${entryFee}`);
        await this.handleQueueTimeout(userId, gameType, maxPlayers, entryFee);
        this.queueTimeoutTimers.delete(timeoutKey);
      } catch (error) {
        logger.error(`Error handling queue timeout for user ${userId}:`, error);
        this.queueTimeoutTimers.delete(timeoutKey);
      }
    }, 120000); // 2 minutes = 120,000 milliseconds

    this.queueTimeoutTimers.set(timeoutKey, timer);
  }

  // Handle queue timeout - show popup and refund
  async handleQueueTimeout(userId, gameType, maxPlayers, entryFee) {
    try {
      // Check if user is still in queue
      const queueEntry = await prisma.matchmakingQueue.findFirst({
        where: {
          userId,
          gameType,
          maxPlayers,
          entryFee
        }
      });

      if (!queueEntry) {
        logger.info(`User ${userId} no longer in queue - timeout handling not needed`);
        return;
      }

      logger.info(`Queue timeout for user ${userId} - no players found after 2 minutes`);

      // Remove user from queue
      await prisma.matchmakingQueue.deleteMany({
        where: { userId }
      });

      // Refund entry fee if it was a paid game
      if (entryFee > 0) {
        try {
          await walletService.creditWallet(
            userId,
            entryFee,
            'REFUND',
            null,
            'Queue timeout refund - no players found'
          );
          logger.info(`Refunded ₹${entryFee} to user ${userId} due to queue timeout`);
        } catch (refundError) {
          logger.error(`Failed to refund user ${userId}:`, refundError);
        }
      }

      // Emit timeout event to user's socket if available
      // This will be handled by the socket connection in server.js
      if (this.onGameCreatedCallback) {
        // Use callback to notify about timeout
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

  // Clear queue timeout timer when user leaves queue or game starts
  clearQueueTimeoutTimer(userId, gameType, maxPlayers, entryFee) {
    const timeoutKey = `${userId}_${gameType}_${maxPlayers}_${entryFee}`;
    
    if (this.queueTimeoutTimers.has(timeoutKey)) {
      clearTimeout(this.queueTimeoutTimers.get(timeoutKey));
      this.queueTimeoutTimers.delete(timeoutKey);
      logger.info(`Cleared queue timeout timer for user ${userId}`);
    }
  }

  // Clear all timeout timers for a user
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
      logger.info(`Cleared timeout timer: ${timeoutKey}`);
    });
  }

  // Get a bot that hasn't played against this user recently
  async getUnusedBotForUser(userId, gameType, entryFee, maxPlayers) {
    try {
      // Get user's recent bot opponents (last 10 games)
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
                include: {
                  user: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 10
      });

      // Extract bot IDs that this user has played against recently
      const recentBotIds = new Set();
      recentGames.forEach(participation => {
        participation.game.participants.forEach(participant => {
          if (participant.user.isBot && participant.userId !== userId) {
            recentBotIds.add(participant.userId);
          }
        });
      });

      logger.info(`User ${userId} has played against ${recentBotIds.size} bots recently: [${Array.from(recentBotIds).join(', ')}]`);

      // Find available bots that haven't played against this user recently
      const availableBots = await prisma.user.findMany({
        where: {
          isBot: true,
          id: {
            notIn: Array.from(recentBotIds)
          },
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

      logger.info(`Found ${availableBots.length} unused bots for user ${userId}`);

      let selectedBot;
      if (availableBots.length > 0) {
        // Randomly select from unused bots
        selectedBot = availableBots[Math.floor(Math.random() * availableBots.length)];
        logger.info(`Selected unused bot: ${selectedBot.name} for user ${userId}`);
      } else {
        // If no unused bots available, create a new one
        logger.info(`No unused bots available for user ${userId}, creating new bot`);
        selectedBot = await botService.createBotUser();
      }

      // Ensure bot has sufficient balance
      if (entryFee > 0) {
        const currentWallet = await prisma.wallet.findUnique({
          where: { userId: selectedBot.id }
        });
        
        if (!currentWallet || currentWallet.gameBalance < entryFee) {
          const currentBalance = currentWallet ? currentWallet.gameBalance : 0;
          const amountToAdd = Math.max(1000, entryFee * 10);
          
          logger.info(`Bot ${selectedBot.name} has insufficient balance (₹${currentBalance}), adding ₹${amountToAdd}`);
          
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
      logger.error('Error getting unused bot for user:', error);
      // Fallback to regular bot selection
      return await botService.getBotForMatchmaking(gameType, entryFee, maxPlayers);
    }
  }

  // Check for real user matches and prioritize them
  async checkRealUserMatches() {
    try {
      // Find groups with only real users (no bots)
      const realUserGroups = await prisma.matchmakingQueue.groupBy({
        by: ['gameType', 'maxPlayers', 'entryFee'],
        _count: {
          id: true
        },
        where: {
          user: {
            isBot: false
          }
        },
        having: {
          id: {
            _count: {
              gte: 2 // At least 2 real users
            }
          }
        },
        orderBy: {
          _count: {
            id: 'desc'
          }
        }
      });

      let gamesCreated = 0;
      
      for (const group of realUserGroups) {
        const { gameType, maxPlayers, entryFee } = group;
        
        // Check actual count of real users in this specific queue
        const actualRealUsers = await prisma.matchmakingQueue.count({
          where: {
            gameType,
            maxPlayers,
            entryFee,
            user: {
              isBot: false
            }
          }
        });

        logger.info(`Real user priority check: ${actualRealUsers} real users for ${gameType} ${maxPlayers}P ₹${entryFee}`);
        
        if (actualRealUsers >= maxPlayers) {
          // Create games with real users only
          const possibleGames = Math.floor(actualRealUsers / maxPlayers);
          
          for (let i = 0; i < possibleGames; i++) {
            try {
              const game = await this.createGame(gameType, maxPlayers, entryFee);
              if (game) {
                gamesCreated++;
                logger.info(`🎯 REAL USER MATCH: Created game ${game.id} with ${maxPlayers} real players!`);
              }
            } catch (error) {
              logger.error(`Failed to create real user game:`, error);
              break;
            }
          }
        }
      }
      
      return gamesCreated;
    } catch (error) {
      logger.error('Error checking real user matches:', error);
      return 0;
    }
  }

  // Check for mixed matches (real users + bots) after 30 seconds
  async checkMixedMatches() {
    try {
      // Find all queue groups that have enough total players (real + bots)
      const allGroups = await prisma.matchmakingQueue.groupBy({
        by: ['gameType', 'maxPlayers', 'entryFee'],
        _count: {
          id: true
        },
        having: {
          id: {
            _count: {
              gte: 2 // Minimum 2 players needed for any game
            }
          }
        },
        orderBy: {
          _count: {
            id: 'desc' // Prioritize groups with more players
          }
        }
      });

      let gamesCreated = 0;
      
      for (const group of allGroups) {
        const { gameType, maxPlayers, entryFee } = group;
        const totalPlayers = group._count.id;

        // Check how many are real users vs bots
        const realUsersCount = await prisma.matchmakingQueue.count({
          where: {
            gameType,
            maxPlayers,
            entryFee,
            user: { isBot: false }
          }
        });

        const botsCount = totalPlayers - realUsersCount;

        // Check if any real users have been waiting for more than 30 seconds
        const oldestRealUser = await prisma.matchmakingQueue.findFirst({
          where: {
            gameType,
            maxPlayers,
            entryFee,
            user: { isBot: false }
          },
          orderBy: {
            createdAt: 'asc'
          }
        });

        const waitTime = oldestRealUser ? Date.now() - oldestRealUser.createdAt.getTime() : 0;
        const hasWaitedLongEnough = waitTime >= 30000; // 30 seconds

        logger.info(`Mixed match check: ${gameType} ${maxPlayers}P ₹${entryFee} - Total: ${totalPlayers} (Real: ${realUsersCount}, Bots: ${botsCount}), Wait time: ${Math.round(waitTime/1000)}s`);
        
        // Only create mixed games if:
        // 1. We have at least 1 real user
        // 2. Real users have waited at least 30 seconds
        // 3. We have enough total players
        if (realUsersCount > 0 && totalPlayers >= maxPlayers && hasWaitedLongEnough) {
          const possibleGames = Math.floor(totalPlayers / maxPlayers);
          
          for (let i = 0; i < possibleGames; i++) {
            try {
              const game = await this.createGame(gameType, maxPlayers, entryFee);
              if (game) {
                gamesCreated++;
                logger.info(`🤖 MIXED MATCH: Created game ${game.id} with ${maxPlayers} players (${realUsersCount} real, ${botsCount} bots)`);
              } else {
                logger.info(`Mixed game creation ${i + 1}/${possibleGames} failed due to insufficient players, stopping batch`);
                break;
              }
            } catch (error) {
              logger.error(`Failed to create mixed game ${i + 1}/${possibleGames}:`, error);
              break;
            }
          }
        } else if (realUsersCount === 0) {
          logger.info(`No real users in queue for ${gameType} ${maxPlayers}P ₹${entryFee} - skipping bot-only games`);
        } else if (!hasWaitedLongEnough) {
          logger.info(`Real users in ${gameType} ${maxPlayers}P ₹${entryFee} haven't waited 30s yet (${Math.round(waitTime/1000)}s) - prioritizing real user matches`);
        } else {
          logger.info(`Not enough total players for ${gameType} ${maxPlayers}P ₹${entryFee}. Need: ${maxPlayers}, Have: ${totalPlayers}`);
        }
      }
      
      return gamesCreated;
    } catch (error) {
      logger.error('Error checking mixed matches:', error);
      return 0;
    }
  }
}

module.exports = new MatchmakingService();
