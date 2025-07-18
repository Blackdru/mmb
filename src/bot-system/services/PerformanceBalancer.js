const logger = require('../../config/logger');
const prisma = require('../../config/database');
const botService = require('../../services/BotService');

class PerformanceBalancer {
  constructor() {
    this.performanceCache = new Map();
    this.botTypePerformance = new Map();
    this.globalMetrics = {
      totalGames: 0,
      humanWins: 0,
      botWins: 0,
      lastReset: Date.now(),
      winningBotWins: 0,
      normalBotWins: 0
    };
    
    this.windowSize = 15;
    this.monitoringEnabled = true;
    
    // Bot type categories for performance tracking
    this.winningBotTypes = [
      'strategic_master', 'analytical_genius', 'tactical_expert', 
      'adaptive_champion', 'intuitive_player', 'calculated_winner', 'smart_competitor'
    ];
    
    this.normalBotTypes = [
      'casual_player', 'random_player', 'beginner_bot'
    ];
  }

  // Analyze player performance for matchmaking insights
  async analyzePlayerPerformance(playerId) {
    try {
      const cacheKey = `${playerId}_${Date.now()}`;
      
      if (this.performanceCache.has(playerId)) {
        const cached = this.performanceCache.get(playerId);
        if (Date.now() - cached.timestamp < 60000) {
          return cached.data;
        }
      }

      const recentGames = await prisma.game.findMany({
        where: {
          participants: {
            some: { userId: playerId }
          },
          status: 'FINISHED',
          finishedAt: {
            not: null
          }
        },
        orderBy: {
          finishedAt: 'desc'
        },
        take: this.windowSize,
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  isBot: true,
                  botType: true
                }
              }
            }
          }
        }
      });

      const performance = this.calculatePerformanceMetrics(recentGames, playerId);
      
      this.performanceCache.set(playerId, {
        timestamp: Date.now(),
        data: performance
      });

      return performance;
    } catch (error) {
      logger.error('Performance analysis failed:', error);
      return this.getDefaultPerformance();
    }
  }

  // Calculate comprehensive performance metrics
  calculatePerformanceMetrics(games, playerId) {
    if (games.length === 0) {
      return this.getDefaultPerformance();
    }

    const results = games.map(game => {
      const playerParticipant = game.participants.find(p => p.userId === playerId);
      const isWin = playerParticipant && playerParticipant.position === 1;
      
      const opponent = game.participants.find(p => p.userId !== playerId);
      const opponentIsBot = opponent && opponent.user.isBot;
      const opponentBotType = opponent && opponent.user.botType;

      return {
        won: isWin,
        againstBot: opponentIsBot,
        opponentBotType,
        gameId: game.id,
        timestamp: game.finishedAt
      };
    });

    const totalGames = results.length;
    const wins = results.filter(r => r.won).length;
    const winRate = wins / totalGames;

    const botGames = results.filter(r => r.againstBot);
    const botGameWins = botGames.filter(r => r.won).length;
    const botWinRate = botGames.length > 0 ? botGameWins / botGames.length : 0.5;

    // Analyze performance against different bot types
    const winningBotGames = botGames.filter(r => this.winningBotTypes.includes(r.opponentBotType));
    const normalBotGames = botGames.filter(r => this.normalBotTypes.includes(r.opponentBotType));
    
    const winningBotWinRate = winningBotGames.length > 0 ? 
      winningBotGames.filter(r => r.won).length / winningBotGames.length : 0.5;
    const normalBotWinRate = normalBotGames.length > 0 ? 
      normalBotGames.filter(r => r.won).length / normalBotGames.length : 0.5;

    const trend = this.calculateTrend(results);
    const consistency = this.calculateConsistency(results);

    return {
      totalGames,
      winRate,
      botWinRate,
      winningBotWinRate,
      normalBotWinRate,
      trend,
      consistency,
      shouldAdjust: false, // No longer adjusting bot difficulty
      botTypeBreakdown: this.analyzeBotTypePerformance(botGames)
    };
  }

  // Analyze performance against specific bot types
  analyzeBotTypePerformance(botGames) {
    const breakdown = {};
    
    botGames.forEach(game => {
      const botType = game.opponentBotType || 'unknown';
      if (!breakdown[botType]) {
        breakdown[botType] = { games: 0, wins: 0, winRate: 0 };
      }
      breakdown[botType].games++;
      if (game.won) {
        breakdown[botType].wins++;
      }
    });

    // Calculate win rates
    Object.keys(breakdown).forEach(botType => {
      const data = breakdown[botType];
      data.winRate = data.wins / data.games;
    });

    return breakdown;
  }

  // Calculate performance trend
  calculateTrend(results) {
    if (results.length < 3) return 'stable';

    const recentHalf = results.slice(0, Math.floor(results.length / 2));
    const olderHalf = results.slice(Math.floor(results.length / 2));

    const recentWinRate = recentHalf.filter(r => r.won).length / recentHalf.length;
    const olderWinRate = olderHalf.filter(r => r.won).length / olderHalf.length;

    const difference = recentWinRate - olderWinRate;

    if (difference > 0.2) return 'improving';
    if (difference < -0.2) return 'declining';
    return 'stable';
  }

  // Calculate consistency patterns
  calculateConsistency(results) {
    let streaks = [];
    let currentStreak = 0;
    let lastResult = null;

    for (const result of results) {
      if (lastResult === null || result.won === lastResult) {
        currentStreak++;
      } else {
        streaks.push(currentStreak);
        currentStreak = 1;
      }
      lastResult = result.won;
    }
    streaks.push(currentStreak);

    const avgStreak = streaks.reduce((a, b) => a + b, 0) / streaks.length;
    const maxStreak = Math.max(...streaks);

    if (maxStreak >= 5) return 'streaky';
    if (avgStreak < 1.5) return 'alternating';
    return 'balanced';
  }

  // Record game outcome for monitoring
  async recordGameOutcome(gameId, winnerId, participants) {
    try {
      const humanParticipant = participants.find(p => !p.user.isBot);
      const botParticipant = participants.find(p => p.user.isBot);

      if (!humanParticipant || !botParticipant) {
        return;
      }

      this.globalMetrics.totalGames++;
      
      if (winnerId === humanParticipant.userId) {
        this.globalMetrics.humanWins++;
      } else {
        this.globalMetrics.botWins++;
        
        // Track wins by bot type
        const botType = botParticipant.user.botType;
        if (this.winningBotTypes.includes(botType)) {
          this.globalMetrics.winningBotWins++;
        } else if (this.normalBotTypes.includes(botType)) {
          this.globalMetrics.normalBotWins++;
        }
      }

      // Track bot type performance
      await this.trackBotTypePerformance(botParticipant.user.botType, winnerId === botParticipant.userId);

      // Log performance every 50 games
      if (this.globalMetrics.totalGames % 50 === 0) {
        await this.logPerformanceMetrics();
      }

    } catch (error) {
      logger.error('Failed to record game outcome:', error);
    }
  }

  // Track performance by bot type
  async trackBotTypePerformance(botType, botWon) {
    if (!botType) return;

    if (!this.botTypePerformance.has(botType)) {
      this.botTypePerformance.set(botType, {
        games: 0,
        wins: 0,
        winRate: 0,
        lastUpdated: Date.now()
      });
    }

    const performance = this.botTypePerformance.get(botType);
    performance.games++;
    if (botWon) {
      performance.wins++;
    }
    performance.winRate = performance.wins / performance.games;
    performance.lastUpdated = Date.now();

    // Track bot performance in the main bot service
    await botService.trackBotPerformance(botType, { won: botWon });
  }

  // Log comprehensive performance metrics
  async logPerformanceMetrics() {
    const totalGames = this.globalMetrics.totalGames;
    const humanWinRate = this.globalMetrics.humanWins / totalGames;
    const botWinRate = this.globalMetrics.botWins / totalGames;
    const winningBotWinRate = this.globalMetrics.winningBotWins / this.globalMetrics.botWins;
    const normalBotWinRate = this.globalMetrics.normalBotWins / this.globalMetrics.botWins;

    logger.info('🎯 Performance Metrics Summary:', {
      totalGames,
      humanWinRate: (humanWinRate * 100).toFixed(1) + '%',
      botWinRate: (botWinRate * 100).toFixed(1) + '%',
      winningBotContribution: (winningBotWinRate * 100).toFixed(1) + '%',
      normalBotContribution: (normalBotWinRate * 100).toFixed(1) + '%'
    });

    // Log bot type performance
    logger.info('🤖 Bot Type Performance:');
    for (const [botType, performance] of this.botTypePerformance.entries()) {
      const config = botService.getBotTypeConfig(botType);
      const expectedWinRate = config.winProbability;
      const actualWinRate = performance.winRate;
      const deviation = Math.abs(actualWinRate - expectedWinRate);

      logger.info(`  ${config.name}: ${(actualWinRate * 100).toFixed(1)}% (expected: ${(expectedWinRate * 100).toFixed(1)}%, deviation: ${(deviation * 100).toFixed(1)}%)`);
    }
  }

  // Get bot type recommendation for matchmaking
  async getBotTypeRecommendation(humanPlayerId) {
    try {
      const humanPerformance = await this.analyzePlayerPerformance(humanPlayerId);
      
      // Simple recommendation based on human performance
      if (humanPerformance.winRate > 0.7) {
        // Strong player - recommend winning bots
        return this.winningBotTypes[Math.floor(Math.random() * this.winningBotTypes.length)];
      } else if (humanPerformance.winRate < 0.3) {
        // Struggling player - recommend normal bots
        return this.normalBotTypes[Math.floor(Math.random() * this.normalBotTypes.length)];
      } else {
        // Average player - mixed recommendation (70% winning, 30% normal)
        const useWinningBot = Math.random() < 0.7;
        return useWinningBot ? 
          this.winningBotTypes[Math.floor(Math.random() * this.winningBotTypes.length)] :
          this.normalBotTypes[Math.floor(Math.random() * this.normalBotTypes.length)];
      }
    } catch (error) {
      logger.error('Bot type recommendation failed:', error);
      // Default to random selection
      return Math.random() < 0.7 ? 
        this.winningBotTypes[Math.floor(Math.random() * this.winningBotTypes.length)] :
        this.normalBotTypes[Math.floor(Math.random() * this.normalBotTypes.length)];
    }
  }

  // Get performance insights for admin dashboard
  async getPerformanceInsights() {
    const totalGames = this.globalMetrics.totalGames;
    
    if (totalGames === 0) {
      return {
        message: 'No games recorded yet',
        metrics: this.globalMetrics,
        botTypePerformance: {}
      };
    }

    const humanWinRate = this.globalMetrics.humanWins / totalGames;
    const insights = [];

    // Generate insights
    if (humanWinRate > 0.6) {
      insights.push('Humans are winning more than expected. Consider deploying more winning bots.');
    } else if (humanWinRate < 0.4) {
      insights.push('Bots are dominating. Consider deploying more normal bots for balance.');
    } else {
      insights.push('Win rates are well balanced between humans and bots.');
    }

    // Bot type insights
    const botTypeInsights = {};
    for (const [botType, performance] of this.botTypePerformance.entries()) {
      const config = botService.getBotTypeConfig(botType);
      const expectedWinRate = config.winProbability;
      const actualWinRate = performance.winRate;
      const deviation = actualWinRate - expectedWinRate;

      botTypeInsights[botType] = {
        expected: expectedWinRate,
        actual: actualWinRate,
        deviation,
        games: performance.games,
        status: Math.abs(deviation) < 0.1 ? 'on_target' : 
                deviation > 0.1 ? 'overperforming' : 'underperforming'
      };
    }

    return {
      insights,
      metrics: {
        ...this.globalMetrics,
        humanWinRate,
        botWinRate: 1 - humanWinRate
      },
      botTypePerformance: botTypeInsights,
      recommendations: this.generateRecommendations(botTypeInsights)
    };
  }

  // Generate recommendations based on performance
  generateRecommendations(botTypeInsights) {
    const recommendations = [];

    Object.entries(botTypeInsights).forEach(([botType, insight]) => {
      if (insight.status === 'underperforming' && insight.games > 10) {
        recommendations.push(`${botType} is underperforming. Consider reviewing its strategy.`);
      } else if (insight.status === 'overperforming' && insight.games > 10) {
        recommendations.push(`${botType} is overperforming. Working as intended.`);
      }
    });

    if (recommendations.length === 0) {
      recommendations.push('All bot types are performing within expected ranges.');
    }

    return recommendations;
  }

  // Get default performance for new players
  getDefaultPerformance() {
    return {
      totalGames: 0,
      winRate: 0.5,
      botWinRate: 0.5,
      winningBotWinRate: 0.5,
      normalBotWinRate: 0.5,
      trend: 'stable',
      consistency: 'balanced',
      shouldAdjust: false,
      botTypeBreakdown: {}
    };
  }

  // Reset cache for specific player or all
  resetCache(playerId = null) {
    if (playerId) {
      this.performanceCache.delete(playerId);
    } else {
      this.performanceCache.clear();
    }
  }

  // Reset all metrics (admin function)
  resetAllMetrics() {
    this.globalMetrics = {
      totalGames: 0,
      humanWins: 0,
      botWins: 0,
      lastReset: Date.now(),
      winningBotWins: 0,
      normalBotWins: 0
    };
    this.botTypePerformance.clear();
    this.performanceCache.clear();
    
    logger.info('🔄 All performance metrics have been reset');
  }

  // Get current statistics
  getCurrentStatistics() {
    return {
      globalMetrics: this.globalMetrics,
      botTypePerformance: Object.fromEntries(this.botTypePerformance),
      cacheSize: this.performanceCache.size,
      monitoringEnabled: this.monitoringEnabled
    };
  }

  // Enable/disable monitoring
  setMonitoring(enabled) {
    this.monitoringEnabled = enabled;
    logger.info(`Performance monitoring ${enabled ? 'enabled' : 'disabled'}`);
  }
}

module.exports = new PerformanceBalancer();