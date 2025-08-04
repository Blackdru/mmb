const prisma = require('../config/database');
const logger = require('../config/logger');

class BotService {
  constructor() {
    // Track recently used bots to ensure variety
    this.recentlyUsedBots = new Map(); // botId -> timestamp
    this.botCooldownMs = 5 * 60 * 1000; // 5 minutes cooldown
    
    // 60 Bot profile names for creating diverse bots
    this.botProfileNames = [
      'NareshMj', 'Siddharth', 'Ganesh', 'Aditya', 'Krishna', 'Ramakrishna',
      'Ritesh', 'Arjun', 'Veerendra', 'Mahesh', 'Sandeep', 'Narayan',
      'Vijay', 'Yashwanth', 'Abhishek', 'Rajeev', 'Vijaya', 'Chetan',
      'Vivek', 'Suresh', 'Veera', 'Praveen', 'Raghav', 'Vikas',
      'Ankit', 'Kalyan', 'Vishal', 'Dinesh', 'Kiran', 'Jayanthi',
      'Uday', 'Harshad', 'Bala', 'Nagaraju', 'Aman', 'Nikhil',
      'Swamycharan', 'Varun', 'Chandan', 'Pawan', 'Jagadeesh', 'Prasad',
      'Amarnath', 'Srinivas', 'Vinay', 'Tejaswi', 'Veerabhadra', 'Karthik',
      'Satya', 'Gopal', 'Ravi', 'Mohan', 'Deepak', 'Rajesh',
      'Sunil', 'Ashok', 'Pradeep', 'Manoj', 'Rohit', 'Vikram'
    ];

    this.botSurnames = [
      'Kumar', 'Reddy', 'Singh', 'Sharma', 'Patel', 'Gupta',
      'Verma', 'Yadav', 'Choudhary', 'Mehta', 'Jain', 'Kaur', 'Das',
      'Bhat', 'Nair', 'Menon', 'Iyer', 'Shekhar', 'Chopra', 'Mishra',
      'Shetty', 'Joshi', 'Rao', 'Kumar', 'Chauhan', 'Shah', 'Mudiraj', 'Raj'
    ];

    // Track used name combinations to ensure uniqueness
    this.usedNameCombinations = new Set();

    // 10 Bot Types: 7 Intelligent Winning Bots (100% win rate) + 3 Normal/Random Bots
    this.botTypes = {
      // 7 Intelligent Winning Bot Types (Human-like behavior with 100% win probability)
      STRATEGIC_MASTER: {
        id: 'strategic_master',
        name: 'Strategic Master',
        winProbability: 1.0, // 100% win rate
        intelligence: 'strategic',
        humanBehavior: {
          thinkingTimeMin: 1200,
          thinkingTimeMax: 3500,
          mistakeProbability: 0.02, // Very low mistake rate
          adaptivePlay: true,
          memoryAccuracy: 0.91, // Near perfect memory
          patternRecognition: 0.95,
          humanLikeDelay: true,
          naturalVariation: 0.15
        },
        gameplayStyle: {
          planningDepth: 5,
          riskTolerance: 0.2,
          aggressiveness: 0.8,
          patience: 0.95,
          perfectMemory: true
        }
      },
      ANALYTICAL_GENIUS: {
        id: 'analytical_genius',
        name: 'Analytical Genius',
        winProbability: 1.0, // 100% win rate
        intelligence: 'analytical',
        humanBehavior: {
          thinkingTimeMin: 1500,
          thinkingTimeMax: 4000,
          mistakeProbability: 0.03,
          adaptivePlay: true,
          memoryAccuracy: 0.90,
          patternRecognition: 0.98,
          humanLikeDelay: true,
          naturalVariation: 0.18
        },
        gameplayStyle: {
          planningDepth: 4,
          riskTolerance: 0.15,
          aggressiveness: 0.7,
          patience: 0.98,
          perfectMemory: true
        }
      },
      TACTICAL_EXPERT: {
        id: 'tactical_expert',
        name: 'Tactical Expert',
        winProbability: 1.0, // 100% win rate
        intelligence: 'tactical',
        humanBehavior: {
          thinkingTimeMin: 1000,
          thinkingTimeMax: 2800,
          mistakeProbability: 0.04,
          adaptivePlay: true,
          memoryAccuracy: 0.89,
          patternRecognition: 0.92,
          humanLikeDelay: true,
          naturalVariation: 0.20
        },
        gameplayStyle: {
          planningDepth: 4,
          riskTolerance: 0.25,
          aggressiveness: 0.85,
          patience: 0.85,
          perfectMemory: true
        }
      },
      ADAPTIVE_CHAMPION: {
        id: 'adaptive_champion',
        name: 'Adaptive Champion',
        winProbability: 1.0, // 100% win rate
        intelligence: 'adaptive',
        humanBehavior: {
          thinkingTimeMin: 900,
          thinkingTimeMax: 2500,
          mistakeProbability: 0.05,
          adaptivePlay: true,
          memoryAccuracy: 0.87,
          patternRecognition: 0.88,
          humanLikeDelay: true,
          naturalVariation: 0.22
        },
        gameplayStyle: {
          planningDepth: 3,
          riskTolerance: 0.35,
          aggressiveness: 0.75,
          patience: 0.90,
          perfectMemory: true
        }
      },
      INTUITIVE_PLAYER: {
        id: 'intuitive_player',
        name: 'Intuitive Player',
        winProbability: 1.0, // 100% win rate
        intelligence: 'intuitive',
        humanBehavior: {
          thinkingTimeMin: 800,
          thinkingTimeMax: 2200,
          mistakeProbability: 0.06,
          adaptivePlay: true,
          memoryAccuracy: 0.85,
          patternRecognition: 0.85,
          humanLikeDelay: true,
          naturalVariation: 0.25
        },
        gameplayStyle: {
          planningDepth: 3,
          riskTolerance: 0.40,
          aggressiveness: 0.70,
          patience: 0.80,
          perfectMemory: true
        }
      },
      CALCULATED_WINNER: {
        id: 'calculated_winner',
        name: 'Calculated Winner',
        winProbability: 1.0, // 100% win rate
        intelligence: 'calculated',
        humanBehavior: {
          thinkingTimeMin: 1100,
          thinkingTimeMax: 3000,
          mistakeProbability: 0.07,
          adaptivePlay: true,
          memoryAccuracy: 0.89,
          patternRecognition: 0.90,
          humanLikeDelay: true,
          naturalVariation: 0.20
        },
        gameplayStyle: {
          planningDepth: 4,
          riskTolerance: 0.20,
          aggressiveness: 0.65,
          patience: 0.95,
          perfectMemory: true
        }
      },
      SMART_COMPETITOR: {
        id: 'smart_competitor',
        name: 'Smart Competitor',
        winProbability: 1.0, // 100% win rate
        intelligence: 'competitive',
        humanBehavior: {
          thinkingTimeMin: 700,
          thinkingTimeMax: 2000,
          mistakeProbability: 0.08,
          adaptivePlay: true,
          memoryAccuracy: 0.88,
          patternRecognition: 0.82,
          humanLikeDelay: true,
          naturalVariation: 0.28
        },
        gameplayStyle: {
          planningDepth: 3,
          riskTolerance: 0.45,
          aggressiveness: 0.90,
          patience: 0.70,
          perfectMemory: true
        }
      },

      // 3 Normal/Random Bot Types (Standard human behavior with random outcomes)
      CASUAL_PLAYER: {
        id: 'casual_player',
        name: 'Casual Player',
        winProbability: 0.45, // Normal human-like win rate
        intelligence: 'casual',
        humanBehavior: {
          thinkingTimeMin: 500,
          thinkingTimeMax: 1800,
          mistakeProbability: 0.35,
          adaptivePlay: false,
          memoryAccuracy: 0.60,
          patternRecognition: 0.50,
          humanLikeDelay: true,
          naturalVariation: 0.40
        },
        gameplayStyle: {
          planningDepth: 1,
          riskTolerance: 0.8,
          aggressiveness: 0.4,
          patience: 0.3,
          perfectMemory: false
        }
      },
      RANDOM_PLAYER: {
        id: 'random_player',
        name: 'Random Player',
        winProbability: 0.40, // Normal human-like win rate
        intelligence: 'random',
        humanBehavior: {
          thinkingTimeMin: 300,
          thinkingTimeMax: 1500,
          mistakeProbability: 0.45,
          adaptivePlay: false,
          memoryAccuracy: 0.50,
          patternRecognition: 0.40,
          humanLikeDelay: true,
          naturalVariation: 0.50
        },
        gameplayStyle: {
          planningDepth: 1,
          riskTolerance: 0.9,
          aggressiveness: 0.5,
          patience: 0.2,
          perfectMemory: false
        }
      },
      BEGINNER_BOT: {
        id: 'beginner_bot',
        name: 'Beginner Bot',
        winProbability: 0.50, // Normal human-like win rate
        intelligence: 'beginner',
        humanBehavior: {
          thinkingTimeMin: 400,
          thinkingTimeMax: 2000,
          mistakeProbability: 0.50,
          adaptivePlay: false,
          memoryAccuracy: 0.45,
          patternRecognition: 0.35,
          humanLikeDelay: true,
          naturalVariation: 0.45
        },
        gameplayStyle: {
          planningDepth: 1,
          riskTolerance: 0.7,
          aggressiveness: 0.3,
          patience: 0.4,
          perfectMemory: false
        }
      }
    };

    // Bot type distribution for creating balanced bot pools
    this.botTypeDistribution = {
      winning: ['strategic_master', 'analytical_genius', 'tactical_expert', 'adaptive_champion', 'intuitive_player', 'calculated_winner', 'smart_competitor'],
      normal: ['casual_player', 'random_player', 'beginner_bot']
    };

    // Track bot performance for monitoring
    this.botPerformanceTracking = new Map();
  }

  // Generate unique bot name using first name + surname combination
  generateUniqueBotName() {
    let attempts = 0;
    const maxAttempts = 100; // Prevent infinite loop
    
    while (attempts < maxAttempts) {
      const randomFirstName = this.botProfileNames[Math.floor(Math.random() * this.botProfileNames.length)];
      const randomSurname = this.botSurnames[Math.floor(Math.random() * this.botSurnames.length)];
      const fullName = `${randomFirstName} ${randomSurname}`;
      
      // Check if this combination has been used recently
      if (!this.usedNameCombinations.has(fullName)) {
        this.usedNameCombinations.add(fullName);
        
        // Clean up old combinations if we have too many (keep last 1000)
        if (this.usedNameCombinations.size > 1000) {
          const oldCombinations = Array.from(this.usedNameCombinations).slice(0, 500);
          oldCombinations.forEach(name => this.usedNameCombinations.delete(name));
        }
        
        return fullName;
      }
      
      attempts++;
    }
    
    // Fallback: if we can't find a unique combination, add a small number
    const randomFirstName = this.botProfileNames[Math.floor(Math.random() * this.botProfileNames.length)];
    const randomSurname = this.botSurnames[Math.floor(Math.random() * this.botSurnames.length)];
    const uniqueId = Math.floor(Math.random() * 99) + 1;
    return `${randomFirstName} ${randomSurname}${uniqueId}`;
  }

  // Fisher-Yates shuffle algorithm for true randomness
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Clean up expired bot cooldowns
  cleanupExpiredCooldowns() {
    const now = Date.now();
    const expiredBots = [];
    
    for (const [botId, timestamp] of this.recentlyUsedBots.entries()) {
      if (now - timestamp > this.botCooldownMs) {
        expiredBots.push(botId);
      }
    }
    
    expiredBots.forEach(botId => {
      this.recentlyUsedBots.delete(botId);
    });
    
    if (expiredBots.length > 0) {
      logger.debug(`🤖 Cleaned up cooldown for ${expiredBots.length} bots`);
    }
  }

  // Select bot type based on distribution (7 winning, 3 normal)
  selectBotType() {
    const random = Math.random();
    
    // 70% chance for winning bots, 30% chance for normal bots
    if (random < 0.7) {
      const winningTypes = this.botTypeDistribution.winning;
      return winningTypes[Math.floor(Math.random() * winningTypes.length)];
    } else {
      const normalTypes = this.botTypeDistribution.normal;
      return normalTypes[Math.floor(Math.random() * normalTypes.length)];
    }
  }

  // Get bot type configuration
  getBotTypeConfig(botTypeId) {
    // Convert lowercase bot type ID to uppercase key
    const upperCaseKey = botTypeId ? botTypeId.toUpperCase() : 'CASUAL_PLAYER';
    return this.botTypes[upperCaseKey] || this.botTypes.CASUAL_PLAYER;
  }

  // Create a new bot user with specified type
  async createBotUser(botTypeId = null) {
    try {
      // Select bot type if not specified
      if (!botTypeId) {
        botTypeId = this.selectBotType();
      }

      const botConfig = this.getBotTypeConfig(botTypeId);
      
      // Generate unique bot name using surname
      const botName = this.generateUniqueBotName();
      const botPhone = `+91${Math.floor(Math.random() * 9000000000) + 1000000000}`;
      
      const bot = await prisma.user.create({
        data: {
          phoneNumber: botPhone,
          name: botName,
          isVerified: true,
          isBot: true,
          botType: botTypeId, // Store bot type in database
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

      // Initialize bot performance tracking
      this.botPerformanceTracking.set(bot.id, {
        botType: botTypeId,
        config: botConfig,
        gamesPlayed: 0,
        wins: 0,
        winRate: 0,
        createdAt: Date.now()
      });

      logger.info(`🤖 Bot created: ${bot.name} (${botConfig.name}) - Type: ${botTypeId}`);
      return bot;
    } catch (error) {
      logger.error('Create bot user error:', error);
      throw error;
    }
  }

  // Get bot for matchmaking with intelligent selection - FIXED VERSION
  async getBotForMatchmaking(gameType, entryFee, maxPlayers = 2) {
    try {
      logger.info(`🤖 Looking for available bot for ${gameType} with entry fee ₹${entryFee}, maxPlayers: ${maxPlayers}`);
      
      // Find all available bots that are not in queue and not currently playing
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

      logger.info(`🤖 Found ${availableBots.length} available bots in database`);
      
      let bot;
      
      if (availableBots.length > 0) {
        // Clean up expired cooldowns
        this.cleanupExpiredCooldowns();
        
        // Filter out bots that are in cooldown
        const botsNotInCooldown = availableBots.filter(bot => 
          !this.recentlyUsedBots.has(bot.id)
        );
        
        // If we have bots not in cooldown, prefer them
        const botsToChooseFrom = botsNotInCooldown.length > 0 ? botsNotInCooldown : availableBots;
        
        // Shuffle the array to ensure true randomness
        const shuffledBots = this.shuffleArray([...botsToChooseFrom]);
        bot = shuffledBots[0];
        
        // Mark this bot as recently used
        this.recentlyUsedBots.set(bot.id, Date.now());
        
        const botConfig = this.getBotTypeConfig(bot.botType || 'casual_player');
        logger.info(`🤖 Selected bot: ${bot.name} (${botConfig.name}) from ${availableBots.length} available bots`);
      } else {
        // If no available bot, create one
        logger.info(`🤖 No available bot found, creating new bot`);
        bot = await this.createBotUser();
      }

      // Ensure bot has sufficient balance for the game
      if (entryFee > 0) {
        const currentWallet = await prisma.wallet.findUnique({
          where: { userId: bot.id }
        });
        
        if (!currentWallet || currentWallet.gameBalance < entryFee) {
          const currentBalance = currentWallet ? currentWallet.gameBalance : 0;
          const amountToAdd = Math.max(1000, entryFee * 10);
          
          logger.info(`🤖 Bot ${bot.name} has insufficient balance (₹${currentBalance}), adding ₹${amountToAdd}`);
          
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
        }
      }

      logger.info(`🤖 Bot ${bot.name} ready for deployment (will be added to queue by caller)`);
      return bot;
    } catch (error) {
      logger.error('Get bot for matchmaking error:', error);
      throw error;
    }
  }

  // Create multiple bots with proper distribution
  async createBotPool(totalBots = 10) {
    try {
      const createdBots = [];
      const winningBotsCount = 7;
      const normalBotsCount = 3;

      // Create 7 winning bots
      for (let i = 0; i < winningBotsCount; i++) {
        const winningType = this.botTypeDistribution.winning[i % this.botTypeDistribution.winning.length];
        const bot = await this.createBotUser(winningType);
        createdBots.push(bot);
      }

      // Create 3 normal bots
      for (let i = 0; i < normalBotsCount; i++) {
        const normalType = this.botTypeDistribution.normal[i % this.botTypeDistribution.normal.length];
        const bot = await this.createBotUser(normalType);
        createdBots.push(bot);
      }

      logger.info(`🤖 Created bot pool: ${winningBotsCount} winning bots + ${normalBotsCount} normal bots = ${totalBots} total`);
      return createdBots;
    } catch (error) {
      logger.error('Create bot pool error:', error);
      throw error;
    }
  }

  // Get bot configuration for gameplay
  getBotGameplayConfig(botId) {
    const performance = this.botPerformanceTracking.get(botId);
    if (performance) {
      return performance.config;
    }

    // Fallback: try to get from database
    return this.botTypes.CASUAL_PLAYER;
  }

  // Track bot performance in games
  async trackBotPerformance(botId, gameResult) {
    try {
      if (!this.botPerformanceTracking.has(botId)) {
        // Initialize tracking for existing bot
        const bot = await prisma.user.findUnique({ where: { id: botId } });
        if (bot && bot.isBot) {
          const botConfig = this.getBotTypeConfig(bot.botType || 'casual_player');
          this.botPerformanceTracking.set(botId, {
            botType: bot.botType || 'casual_player',
            config: botConfig,
            gamesPlayed: 0,
            wins: 0,
            winRate: 0,
            createdAt: Date.now()
          });
        }
      }

      const performance = this.botPerformanceTracking.get(botId);
      if (performance) {
        performance.gamesPlayed++;
        if (gameResult.won) {
          performance.wins++;
        }
        performance.winRate = performance.wins / performance.gamesPlayed;

        logger.info(`🤖 Bot ${botId} (${performance.config.name}) performance: ${performance.wins}/${performance.gamesPlayed} (${(performance.winRate * 100).toFixed(1)}%)`);
      }
    } catch (error) {
      logger.error('Track bot performance error:', error);
    }
  }

  // Remove bot from queue
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

  // Get available bots count
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

  // Ensure minimum bots with proper distribution
  async ensureMinimumBots(minCount = 15) {
    try {
      // Get total available bots (not in queue, not in active games)
      const availableCount = await this.getAvailableBotsCount();
      
      // Also check total bots in system
      const totalBots = await prisma.user.count({
        where: { isBot: true }
      });
      
      logger.info(`🤖 Bot Status - Available: ${availableCount}, Total: ${totalBots}, Minimum Required: ${minCount}`);
      
      // If we don't have enough available bots, create more
      if (availableCount < minCount) {
        const botsToCreate = minCount - availableCount;
        logger.info(`🤖 Creating ${botsToCreate} additional bots to meet minimum requirement`);
        
        const createdBots = [];
        
        // Create bots one by one to handle any errors gracefully
        for (let i = 0; i < botsToCreate; i++) {
          try {
            // Maintain 7:3 ratio for winning:normal bots
            const shouldCreateWinningBot = (i % 10) < 7;
            const botType = shouldCreateWinningBot ? 
              this.botTypeDistribution.winning[Math.floor(Math.random() * this.botTypeDistribution.winning.length)] :
              this.botTypeDistribution.normal[Math.floor(Math.random() * this.botTypeDistribution.normal.length)];
            
            const bot = await this.createBotUser(botType);
            createdBots.push(bot);
            
            // Small delay to prevent overwhelming the database
            await new Promise(resolve => setTimeout(resolve, 100));
            
          } catch (createError) {
            logger.error(`🤖 Failed to create bot ${i + 1}/${botsToCreate}:`, createError);
            // Continue creating other bots even if one fails
          }
        }
        
        logger.info(`🤖 Successfully created ${createdBots.length}/${botsToCreate} new bots`);
        
        // Log the final count
        const finalAvailableCount = await this.getAvailableBotsCount();
        logger.info(`🤖 Final available bot count: ${finalAvailableCount}`);
        
        return createdBots;
      } else {
        logger.info(`🤖 Sufficient bots available (${availableCount}/${minCount})`);
        return [];
      }
    } catch (error) {
      logger.error('🤖 Ensure minimum bots error:', error);
      
      // Try to create at least one bot if the system is completely broken
      try {
        logger.info('🤖 Attempting emergency bot creation...');
        const emergencyBot = await this.createBotUser();
        logger.info(`🤖 Emergency bot created: ${emergencyBot.name}`);
        return [emergencyBot];
      } catch (emergencyError) {
        logger.error('🤖 Emergency bot creation failed:', emergencyError);
        return [];
      }
    }
  }

  // Cleanup inactive bots
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

  // Get bot statistics
  async getBotStatistics() {
    try {
      const totalBots = await prisma.user.count({ where: { isBot: true } });
      const availableBots = await this.getAvailableBotsCount();
      
      const botsByType = {};
      for (const [botId, performance] of this.botPerformanceTracking.entries()) {
        const typeName = performance.config.name;
        if (!botsByType[typeName]) {
          botsByType[typeName] = { count: 0, totalWinRate: 0 };
        }
        botsByType[typeName].count++;
        botsByType[typeName].totalWinRate += performance.winRate;
      }

      // Calculate average win rates by type
      for (const type in botsByType) {
        botsByType[type].averageWinRate = botsByType[type].totalWinRate / botsByType[type].count;
      }

      return {
        totalBots,
        availableBots,
        trackedBots: this.botPerformanceTracking.size,
        botsByType
      };
    } catch (error) {
      logger.error('Get bot statistics error:', error);
      return { totalBots: 0, availableBots: 0, trackedBots: 0, botsByType: {} };
    }
  }

  // Legacy method compatibility - intelligent bot selection
  async selectIntelligentBot(humanPlayerId, gameType, entryFee) {
    // For backward compatibility, use the new system
    return await this.getBotForMatchmaking(gameType, entryFee);
  }

  // Legacy method compatibility - get bot profile
  getBotProfile(botName) {
    // Extract base name and try to match with bot types
    const baseName = botName.replace(/\d+$/, '');
    
    // Return a compatible profile structure
    return {
      name: baseName,
      skillLevel: 0.7, // Default skill level
      intelligence: 'balanced',
      memoryStrength: 0.7,
      adaptability: 0.7
    };
  }

  // Legacy method compatibility - get intelligence config
  getIntelligenceConfig(intelligenceType) {
    const defaultConfig = {
      planningDepth: 2,
      patternRecognition: 0.7,
      riskAssessment: 0.7,
      adaptiveThinking: 0.7
    };

    return defaultConfig;
  }

  // Legacy method compatibility - get bot intelligence multiplier
  getBotIntelligenceMultiplier(botId) {
    const performance = this.botPerformanceTracking.get(botId);
    return performance ? 1.0 : 1.0; // No longer using dynamic adjustment
  }
}

module.exports = new BotService();