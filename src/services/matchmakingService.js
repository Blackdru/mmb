const prisma = require('../config/database');
const logger = require('../config/logger');
const walletService = require('./walletService');
const gameService = require('./gameService'); // For initializing game board based on game type
const botService = require('./botService'); // For bot players

class MatchmakingService {
  constructor() {
    this.matchmakingInterval = null;
    this.onGameCreatedCallback = null; // Callback to notify server.js
    this.initialized = false;
    this.botDeploymentTimers = new Map(); // Track bot deployment timers for each queue
    this.isProcessingMatchmaking = false; // Prevent concurrent matchmaking cycles
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
    }, 5000);
    logger.info('Matchmaking interval started, running every 5 seconds.');
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
  }

  setGameCreatedCallback(callback) {
    this.onGameCreatedCallback = callback;
  }

  async joinQueue(userId, gameType, maxPlayers, entryFee) {
    try {
      logger.info(`🎯 User ${userId} attempting to join queue: ${gameType} - ${maxPlayers}P - ₹${entryFee}`);
      
      // Check if user has sufficient balance (skip for free games)
      if (entryFee > 0) {
        const walletBalance = await walletService.getWalletBalance(userId);
        const totalBalance = (walletBalance.gameBalance || 0) + (walletBalance.withdrawableBalance || 0);
        logger.info(`💰 User ${userId} total balance: ₹${totalBalance} (Game: ₹${walletBalance.gameBalance}, Withdrawable: ₹${walletBalance.withdrawableBalance}), required: ₹${entryFee}`);
        if (totalBalance < entryFee) {
          logger.warn(`❌ Insufficient balance for user ${userId} to join queue. Has: ₹${totalBalance}, Needs: ₹${entryFee}`);
          throw new Error('Insufficient balance');
        }
      } else {
        logger.info(`🆓 Free game - skipping balance check for user ${userId}`);
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
        logger.info(`⚠️ User ${userId} already in queue for ${gameType} ${maxPlayers}P ₹${entryFee} (ID: ${existingQueue.id}) - skipping duplicate join`);
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
        logger.info(`⚠️ User ${userId} found in ${otherQueues.length} other queue(s) - removing before adding to new queue`);
        await prisma.matchmakingQueue.deleteMany({
          where: { userId }
        });
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

      logger.info(`✅ User ${userId} successfully joined matchmaking queue (ID: ${queueEntry.id}) for ${gameType} ${maxPlayers}P game.`);

      // Start bot deployment timer for this queue configuration
      this.startBotDeploymentTimer(gameType, maxPlayers, entryFee);

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
      if (deletedCount.count > 0) {
        logger.info(`✅ User ${userId} successfully left matchmaking queue. Removed ${deletedCount.count} entries.`);
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
      logger.info('🔄 Matchmaking cycle already in progress, skipping...');
      return;
    }

    this.isProcessingMatchmaking = true;
    
    try {
      logger.info('🔍 Processing matchmaking cycle...');
      
      // Group queue entries by game type, maxPlayers, and entry fee
      // We need to find groups that have enough players for a game
      const matchableGroups = await prisma.matchmakingQueue.groupBy({
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

      logger.info(`📊 Found ${matchableGroups.length} potential matchable groups.`);

      let gamesCreated = 0;
      for (const group of matchableGroups) {
        const { gameType, maxPlayers, entryFee } = group;
        const availableCount = group._count.id;

        logger.info(`🎮 Evaluating group: GameType: ${gameType}, MaxPlayers: ${maxPlayers}P, EntryFee: ₹${entryFee}, Available: ${availableCount}`);
        
        // Create multiple games if we have enough players
        const possibleGames = Math.floor(availableCount / maxPlayers);
        
        if (possibleGames > 0) {
          logger.info(`✅ Can create ${possibleGames} games with ${maxPlayers} players each from ${availableCount} available players`);
          
          for (let i = 0; i < possibleGames; i++) {
            try {
              const game = await this.createGame(gameType, maxPlayers, entryFee);
              if (game) {
                gamesCreated++;
                logger.info(`🎉 Created game ${i + 1}/${possibleGames} for ${gameType} ${maxPlayers}P ₹${entryFee}`);
              } else {
                logger.info(`⚠️ Game creation ${i + 1}/${possibleGames} failed due to insufficient players, stopping batch`);
                break; // Stop if we can't create more games
              }
            } catch (error) {
              logger.error(`Failed to create game ${i + 1}/${possibleGames}:`, error);
              break; // Stop creating more games if one fails
            }
          }
        } else {
          logger.info(`⚠️ Not enough players for a full ${maxPlayers}-player ${gameType} game. Available: ${availableCount}. Skipping for now.`);
        }
      }
      
      if (gamesCreated > 0) {
        logger.info(`🎉 Matchmaking cycle completed. Created ${gamesCreated} new games.`);
        // Schedule next cycle immediately if games were created
        setTimeout(() => this.processMatchmaking(), 1000);
      } else {
        logger.info('🔍 Matchmaking cycle completed. No new games created in this cycle.');
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
          logger.warn(`❌ Failed to create game: Not enough players found in transaction. Needed: ${playersToMatch}, Found: ${queueEntries.length}.`);
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
                logger.info(`✅ Deducted ₹${entryFee} from user ${queueEntry.userId} for game entry. New balance: ₹${deductionResult.gameBalance}`);
              } else {
                logger.error(`❌ Failed to deduct ₹${entryFee} from user ${queueEntry.userId}: ${deductionResult.message}`);
                throw new Error(`Failed to deduct entry fee from user ${queueEntry.userId}: ${deductionResult.message}`);
              }
            } catch (deductionError) {
              logger.error(`❌ Wallet deduction error for user ${queueEntry.userId}:`, deductionError);
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

      logger.info(`🎉 Game ${result.game.id} successfully created and players matched. Notifying via callback.`);

      // Clear bot deployment timer since game was created
      this.clearBotDeploymentTimer(gameType, playersToMatch, entryFee);

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
    
    // Allow multiple timers for the same configuration to support concurrent games
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
    }, 30000); // 30 seconds

    this.botDeploymentTimers.set(uniqueTimerKey, timer);
  }

  // Deploy a bot if there are waiting players but not enough for a full game
  async deployBotIfNeeded(gameType, maxPlayers, entryFee) {
    try {
      logger.info(`🤖 Checking if bot deployment needed for: ${gameType} ${maxPlayers}P ₹${entryFee}`);

      // Check current queue status
      const queueCount = await prisma.matchmakingQueue.count({
        where: {
          gameType,
          maxPlayers,
          entryFee
        }
      });

      logger.info(`📊 Current queue count: ${queueCount}/${maxPlayers} for ${gameType}`);

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
            
            // Trigger immediate matchmaking check
            setTimeout(() => this.processMatchmaking(), 1000);
          } catch (botError) {
            logger.error(`Failed to deploy bot: ${botError.message}`);
          }
        } else {
          logger.info(`🤖 Only bots in queue for ${gameType} ${maxPlayers}P ₹${entryFee} - not deploying additional bot`);
        }
        
      } else if (queueCount === 0) {
        logger.info(`📭 No players in queue for ${gameType} ${maxPlayers}P ₹${entryFee} - bot deployment not needed`);
      } else if (queueCount >= maxPlayers) {
        logger.info(`✅ Enough players (${queueCount}) for ${gameType} ${maxPlayers}P ₹${entryFee} - bot deployment not needed`);
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
      logger.info(`🤖 Cleared bot deployment timer: ${timerKey}`);
    });
  }
}

module.exports = new MatchmakingService();