const prisma = require('../config/database');
const logger = require('../config/logger');

class BotService {
  constructor() {
    // Track recently used bots to ensure variety
    this.recentlyUsedBots = new Map(); // botId -> timestamp
    this.botCooldownMs = 5 * 60 * 1000; // 5 minutes cooldown
    
    // Enhanced bot profiles with strategic intelligence levels
    this.botProfiles = [
      // Elite Tier (85-95% skill) - Strategic masters
      { name: 'NareshMj', skillLevel: 0.92, intelligence: 'strategic', memoryStrength: 0.95, adaptability: 0.88 },
      { name: 'Siddharth', skillLevel: 0.94, intelligence: 'analytical', memoryStrength: 0.92, adaptability: 0.90 },
      { name: 'Ganesh', skillLevel: 0.95, intelligence: 'tactical', memoryStrength: 0.89, adaptability: 0.85 },
      { name: 'Aditya', skillLevel: 0.93, intelligence: 'strategic', memoryStrength: 0.94, adaptability: 0.87 },
      { name: 'Krishna', skillLevel: 0.90, intelligence: 'analytical', memoryStrength: 0.88, adaptability: 0.92 },
      { name: 'Ramakrishna', skillLevel: 0.89, intelligence: 'tactical', memoryStrength: 0.91, adaptability: 0.86 },
      
      // Advanced Tier (75-84% skill) - Skilled players
      { name: 'Ritesh', skillLevel: 0.84, intelligence: 'adaptive', memoryStrength: 0.82, adaptability: 0.85 },
      { name: 'Arjun', skillLevel: 0.83, intelligence: 'strategic', memoryStrength: 0.85, adaptability: 0.80 },
      { name: 'Veerendra', skillLevel: 0.82, intelligence: 'tactical', memoryStrength: 0.80, adaptability: 0.84 },
      { name: 'Mahesh', skillLevel: 0.81, intelligence: 'analytical', memoryStrength: 0.83, adaptability: 0.78 },
      { name: 'Sandeep', skillLevel: 0.80, intelligence: 'adaptive', memoryStrength: 0.78, adaptability: 0.82 },
      { name: 'Narayan', skillLevel: 0.79, intelligence: 'strategic', memoryStrength: 0.81, adaptability: 0.77 },
      { name: 'Vijay', skillLevel: 0.78, intelligence: 'tactical', memoryStrength: 0.76, adaptability: 0.80 },
      { name: 'Yashwanth', skillLevel: 0.77, intelligence: 'analytical', memoryStrength: 0.79, adaptability: 0.75 },
      { name: 'Abhishek', skillLevel: 0.76, intelligence: 'adaptive', memoryStrength: 0.74, adaptability: 0.78 },
      { name: 'Rajeev', skillLevel: 0.75, intelligence: 'strategic', memoryStrength: 0.77, adaptability: 0.73 },
      
      // Intermediate Tier (65-74% skill) - Competent players
      { name: 'Vijaya', skillLevel: 0.74, intelligence: 'balanced', memoryStrength: 0.72, adaptability: 0.76 },
      { name: 'Chetan', skillLevel: 0.73, intelligence: 'tactical', memoryStrength: 0.75, adaptability: 0.71 },
      { name: 'Vivek', skillLevel: 0.72, intelligence: 'adaptive', memoryStrength: 0.70, adaptability: 0.74 },
      { name: 'Suresh', skillLevel: 0.71, intelligence: 'analytical', memoryStrength: 0.73, adaptability: 0.69 },
      { name: 'Veera', skillLevel: 0.70, intelligence: 'balanced', memoryStrength: 0.68, adaptability: 0.72 },
      { name: 'Praveen', skillLevel: 0.69, intelligence: 'strategic', memoryStrength: 0.71, adaptability: 0.67 },
      { name: 'Raghav', skillLevel: 0.68, intelligence: 'tactical', memoryStrength: 0.66, adaptability: 0.70 },
      { name: 'Vikas', skillLevel: 0.67, intelligence: 'adaptive', memoryStrength: 0.69, adaptability: 0.65 },
      { name: 'Ankit', skillLevel: 0.66, intelligence: 'balanced', memoryStrength: 0.64, adaptability: 0.68 },
      { name: 'Kalyan', skillLevel: 0.65, intelligence: 'analytical', memoryStrength: 0.67, adaptability: 0.63 },
      
      // Casual Tier (55-64% skill) - Average players with occasional brilliance
      { name: 'Vishal', skillLevel: 0.64, intelligence: 'inconsistent', memoryStrength: 0.62, adaptability: 0.66 },
      { name: 'Dinesh', skillLevel: 0.63, intelligence: 'balanced', memoryStrength: 0.65, adaptability: 0.61 },
      { name: 'Kiran', skillLevel: 0.62, intelligence: 'tactical', memoryStrength: 0.60, adaptability: 0.64 },
      { name: 'Jayanthi', skillLevel: 0.61, intelligence: 'adaptive', memoryStrength: 0.63, adaptability: 0.59 },
      { name: 'Uday', skillLevel: 0.60, intelligence: 'inconsistent', memoryStrength: 0.58, adaptability: 0.62 },
      { name: 'Harshad', skillLevel: 0.59, intelligence: 'balanced', memoryStrength: 0.61, adaptability: 0.57 },
      { name: 'Bala', skillLevel: 0.58, intelligence: 'tactical', memoryStrength: 0.56, adaptability: 0.60 },
      { name: 'Nagaraju', skillLevel: 0.57, intelligence: 'adaptive', memoryStrength: 0.59, adaptability: 0.55 },
      { name: 'Aman', skillLevel: 0.56, intelligence: 'inconsistent', memoryStrength: 0.54, adaptability: 0.58 },
      { name: 'Nikhil', skillLevel: 0.55, intelligence: 'balanced', memoryStrength: 0.57, adaptability: 0.53 },
      
      // Developing Tier (45-54% skill) - Learning players with potential
      { name: 'Swamycharan', skillLevel: 0.54, intelligence: 'developing', memoryStrength: 0.52, adaptability: 0.56 },
      { name: 'Varun', skillLevel: 0.53, intelligence: 'inconsistent', memoryStrength: 0.55, adaptability: 0.51 },
      { name: 'Chandan', skillLevel: 0.52, intelligence: 'balanced', memoryStrength: 0.50, adaptability: 0.54 },
      { name: 'Pawan', skillLevel: 0.51, intelligence: 'developing', memoryStrength: 0.53, adaptability: 0.49 },
      { name: 'Jagadeesh', skillLevel: 0.50, intelligence: 'inconsistent', memoryStrength: 0.48, adaptability: 0.52 },
      { name: 'Prasad', skillLevel: 0.49, intelligence: 'balanced', memoryStrength: 0.51, adaptability: 0.47 },
      { name: 'Amarnath', skillLevel: 0.48, intelligence: 'developing', memoryStrength: 0.46, adaptability: 0.50 },
      { name: 'Srinivas', skillLevel: 0.47, intelligence: 'inconsistent', memoryStrength: 0.49, adaptability: 0.45 },
      { name: 'Vinay', skillLevel: 0.46, intelligence: 'balanced', memoryStrength: 0.44, adaptability: 0.48 },
      { name: 'Tejaswi', skillLevel: 0.45, intelligence: 'developing', memoryStrength: 0.47, adaptability: 0.43 },
      
      // Wildcard Tier - Unpredictable players
      { name: 'Veerabhadra', skillLevel: 0.75, intelligence: 'wildcard', memoryStrength: 0.60, adaptability: 0.90 },
      { name: 'Karthik', skillLevel: 0.68, intelligence: 'wildcard', memoryStrength: 0.55, adaptability: 0.85 },
      { name: 'Satya', skillLevel: 0.62, intelligence: 'wildcard', memoryStrength: 0.50, adaptability: 0.80 },
      { name: 'Gopal', skillLevel: 0.58, intelligence: 'wildcard', memoryStrength: 0.45, adaptability: 0.75 }
    ];

    // Intelligence type definitions for strategic gameplay
    this.intelligenceTypes = {
      strategic: {
        planningDepth: 4,
        patternRecognition: 0.9,
        riskAssessment: 0.85,
        adaptiveThinking: 0.8
      },
      analytical: {
        planningDepth: 3,
        patternRecognition: 0.95,
        riskAssessment: 0.9,
        adaptiveThinking: 0.7
      },
      tactical: {
        planningDepth: 2,
        patternRecognition: 0.8,
        riskAssessment: 0.95,
        adaptiveThinking: 0.85
      },
      adaptive: {
        planningDepth: 2,
        patternRecognition: 0.75,
        riskAssessment: 0.8,
        adaptiveThinking: 0.95
      },
      balanced: {
        planningDepth: 2,
        patternRecognition: 0.8,
        riskAssessment: 0.8,
        adaptiveThinking: 0.8
      },
      inconsistent: {
        planningDepth: 1,
        patternRecognition: 0.6,
        riskAssessment: 0.7,
        adaptiveThinking: 0.9
      },
      developing: {
        planningDepth: 1,
        patternRecognition: 0.5,
        riskAssessment: 0.6,
        adaptiveThinking: 0.7
      },
      wildcard: {
        planningDepth: 3,
        patternRecognition: 0.7,
        riskAssessment: 0.6,
        adaptiveThinking: 0.95
      }
    };

    // Target win rate configuration
    this.targetWinRate = 0.65; // 65% win rate for bots
    this.winRateWindow = 20; // Track last 20 games for adjustment
    this.botPerformanceTracking = new Map(); // Track individual bot performance


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
      if (availableBots.length > 0) {
        logger.info(`🤖 Available bot names: ${availableBots.map(bot => bot.name).join(', ')}`);
      }

      let bot;
      
      // If we have available bots, select one randomly with cooldown consideration
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
        
        const cooldownStatus = botsNotInCooldown.length > 0 ? 'fresh' : 'cooldown-ignored';
        logger.info(`🤖 Randomly selected bot: ${bot.name} (${bot.id}) from ${availableBots.length} available bots (${cooldownStatus})`);
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

      // Add bot to matchmaking queue
      const queueEntry = await prisma.matchmakingQueue.create({
        data: {
          userId: bot.id,
          gameType,
          maxPlayers: maxPlayers,
          entryFee
        }
      });

      logger.info(`🤖 Bot ${bot.name} (${bot.id}) successfully added to matchmaking queue (${queueEntry.id}) for ${gameType} ${maxPlayers}P ₹${entryFee}`);
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

  // Enhanced bot intelligence methods
  getBotProfile(botName) {
    const baseName = botName.replace(/\d+$/, ''); // Remove numbers from end
    return this.botProfiles.find(profile => profile.name === baseName) || this.botProfiles[0];
  }

  getIntelligenceConfig(intelligenceType) {
    return this.intelligenceTypes[intelligenceType] || this.intelligenceTypes.balanced;
  }

  async trackBotPerformance(botId, gameResult) {
    try {
      if (!this.botPerformanceTracking.has(botId)) {
        this.botPerformanceTracking.set(botId, {
          gamesPlayed: 0,
          wins: 0,
          recentGames: [],
          winRate: 0,
          adjustmentFactor: 1.0
        });
      }

      const performance = this.botPerformanceTracking.get(botId);
      performance.gamesPlayed++;
      
      if (gameResult.won) {
        performance.wins++;
      }

      // Track recent games (last 20)
      performance.recentGames.push({
        won: gameResult.won,
        timestamp: Date.now(),
        opponent: gameResult.opponentId
      });

      if (performance.recentGames.length > this.winRateWindow) {
        performance.recentGames.shift();
      }

      // Calculate current win rate
      const recentWins = performance.recentGames.filter(game => game.won).length;
      performance.winRate = recentWins / performance.recentGames.length;

      // Adjust bot intelligence based on performance
      performance.adjustmentFactor = this.calculateIntelligenceAdjustment(performance.winRate);

      this.botPerformanceTracking.set(botId, performance);

      logger.info(`🤖 Bot ${botId} performance updated: ${performance.winRate.toFixed(2)} win rate, adjustment: ${performance.adjustmentFactor.toFixed(2)}`);
    } catch (error) {
      logger.error('Track bot performance error:', error);
    }
  }

  calculateIntelligenceAdjustment(currentWinRate) {
    const deviation = currentWinRate - this.targetWinRate;
    
    // If bot is winning too much, reduce intelligence
    if (deviation > 0.1) {
      return Math.max(0.7, 1.0 - (deviation * 2));
    }
    // If bot is losing too much, increase intelligence
    else if (deviation < -0.1) {
      return Math.min(1.3, 1.0 + (Math.abs(deviation) * 2));
    }
    
    return 1.0; // No adjustment needed
  }

  async selectIntelligentBot(humanPlayerId, gameType, entryFee) {
    try {
      // Get human player's recent performance
      const humanPerformance = await this.getHumanPlayerPerformance(humanPlayerId);
      
      // Find available bots
      const availableBots = await prisma.user.findMany({
        where: {
          isBot: true,
          matchmakingQueues: { none: {} },
          gameParticipations: {
            none: {
              game: { status: { in: ['WAITING', 'PLAYING'] } }
            }
          }
        },
        include: { wallet: true }
      });

      if (availableBots.length === 0) {
        return await this.createBotUser();
      }

      // Score bots based on strategic matchmaking
      const scoredBots = availableBots.map(bot => {
        const profile = this.getBotProfile(bot.name);
        const performance = this.botPerformanceTracking.get(bot.id) || { adjustmentFactor: 1.0, winRate: 0.5 };
        
        // Calculate strategic score
        const skillDifference = Math.abs(profile.skillLevel - humanPerformance.estimatedSkill);
        const winRateBalance = Math.abs(performance.winRate - this.targetWinRate);
        
        // Prefer bots that will create balanced matches
        const balanceScore = 1.0 - (skillDifference * 0.5) - (winRateBalance * 0.3);
        
        // Add randomness to prevent predictability
        const randomFactor = 0.8 + (Math.random() * 0.4);
        
        return {
          bot,
          profile,
          performance,
          score: balanceScore * randomFactor
        };
      });

      // Sort by score and select from top candidates
      scoredBots.sort((a, b) => b.score - a.score);
      const topCandidates = scoredBots.slice(0, Math.min(5, scoredBots.length));
      
      // Randomly select from top candidates to maintain unpredictability
      const selectedBot = topCandidates[Math.floor(Math.random() * topCandidates.length)];

      logger.info(`🤖 Intelligently selected bot: ${selectedBot.bot.name} (skill: ${selectedBot.profile.skillLevel}, score: ${selectedBot.score.toFixed(2)})`);
      
      return selectedBot.bot;
    } catch (error) {
      logger.error('Intelligent bot selection error:', error);
      // Fallback to random selection
      return await this.getBotForMatchmaking(gameType, entryFee);
    }
  }

  async getHumanPlayerPerformance(playerId) {
    try {
      const recentGames = await prisma.game.findMany({
        where: {
          participants: { some: { userId: playerId } },
          status: 'FINISHED'
        },
        orderBy: { finishedAt: 'desc' },
        take: 10,
        include: {
          participants: {
            include: { user: { select: { id: true, isBot: true } } }
          }
        }
      });

      if (recentGames.length === 0) {
        return { estimatedSkill: 0.5, winRate: 0.5, gamesPlayed: 0 };
      }

      const wins = recentGames.filter(game => {
        const playerParticipant = game.participants.find(p => p.userId === playerId);
        return playerParticipant && playerParticipant.position === 1;
      }).length;

      const winRate = wins / recentGames.length;
      
      // Estimate skill based on win rate and game patterns
      let estimatedSkill = winRate;
      
      // Adjust based on opponent types
      const botGames = recentGames.filter(game => 
        game.participants.some(p => p.userId !== playerId && p.user.isBot)
      );
      
      if (botGames.length > 0) {
        const botWins = botGames.filter(game => {
          const playerParticipant = game.participants.find(p => p.userId === playerId);
          return playerParticipant && playerParticipant.position === 1;
        }).length;
        
        const botWinRate = botWins / botGames.length;
        estimatedSkill = (estimatedSkill + botWinRate) / 2;
      }

      return {
        estimatedSkill: Math.max(0.2, Math.min(0.9, estimatedSkill)),
        winRate,
        gamesPlayed: recentGames.length
      };
    } catch (error) {
      logger.error('Get human player performance error:', error);
      return { estimatedSkill: 0.5, winRate: 0.5, gamesPlayed: 0 };
    }
  }

  async getGlobalBotPerformance() {
    try {
      const allBotPerformance = Array.from(this.botPerformanceTracking.values());
      
      if (allBotPerformance.length === 0) {
        return { averageWinRate: 0.5, totalGames: 0, needsAdjustment: false };
      }

      const totalGames = allBotPerformance.reduce((sum, perf) => sum + perf.gamesPlayed, 0);
      const totalWins = allBotPerformance.reduce((sum, perf) => sum + perf.wins, 0);
      const averageWinRate = totalWins / totalGames;

      const needsAdjustment = Math.abs(averageWinRate - this.targetWinRate) > 0.05;

      return {
        averageWinRate,
        totalGames,
        needsAdjustment,
        deviation: averageWinRate - this.targetWinRate
      };
    } catch (error) {
      logger.error('Get global bot performance error:', error);
      return { averageWinRate: 0.5, totalGames: 0, needsAdjustment: false };
    }
  }

  async adjustGlobalBotIntelligence() {
    try {
      const globalPerf = await this.getGlobalBotPerformance();
      
      if (!globalPerf.needsAdjustment || globalPerf.totalGames < 50) {
        return;
      }

      const adjustmentFactor = globalPerf.deviation > 0 ? 0.95 : 1.05;
      
      // Apply global adjustment to all tracked bots
      for (const [botId, performance] of this.botPerformanceTracking.entries()) {
        performance.adjustmentFactor *= adjustmentFactor;
        performance.adjustmentFactor = Math.max(0.6, Math.min(1.4, performance.adjustmentFactor));
      }

      logger.info(`🤖 Global bot intelligence adjusted by factor: ${adjustmentFactor} (current win rate: ${globalPerf.averageWinRate.toFixed(3)})`);
    } catch (error) {
      logger.error('Adjust global bot intelligence error:', error);
    }
  }

  getBotIntelligenceMultiplier(botId) {
    const performance = this.botPerformanceTracking.get(botId);
    return performance ? performance.adjustmentFactor : 1.0;
  }

  // Enhanced bot creation with intelligence assignment
  async createIntelligentBot(targetSkillLevel = null) {
    try {
      // Select profile based on target skill or weighted random
      let profile;
      
      if (targetSkillLevel) {
        // Find profile closest to target skill level
        profile = this.botProfiles.reduce((closest, current) => {
          const currentDiff = Math.abs(current.skillLevel - targetSkillLevel);
          const closestDiff = Math.abs(closest.skillLevel - targetSkillLevel);
          return currentDiff < closestDiff ? current : closest;
        });
      } else {
        // Weighted selection favoring higher skill levels for 65% win rate
        const weights = this.botProfiles.map(p => Math.pow(p.skillLevel, 2));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        const random = Math.random() * totalWeight;
        
        let cumulativeWeight = 0;
        for (let i = 0; i < this.botProfiles.length; i++) {
          cumulativeWeight += weights[i];
          if (random <= cumulativeWeight) {
            profile = this.botProfiles[i];
            break;
          }
        }
      }

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

      // Initialize performance tracking
      this.botPerformanceTracking.set(bot.id, {
        gamesPlayed: 0,
        wins: 0,
        recentGames: [],
        winRate: 0.5,
        adjustmentFactor: 1.0,
        profile: profile
      });

      logger.info(`🤖 Intelligent bot created: ${bot.name} (skill: ${profile.skillLevel}, intelligence: ${profile.intelligence})`);
      return bot;
    } catch (error) {
      logger.error('Create intelligent bot error:', error);
      throw error;
    }
  }
}

module.exports = new BotService();