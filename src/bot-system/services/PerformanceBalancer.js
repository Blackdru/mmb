const logger = require('../../config/logger');
const prisma = require('../../config/database');

class PerformanceBalancer {
  constructor() {
    this.performanceCache = new Map();
    this.adjustmentHistory = new Map();
    this.globalMetrics = {
      totalGames: 0,
      humanWins: 0,
      botWins: 0,
      lastReset: Date.now()
    };
    
    this.windowSize = 10;
    this.targetWinRate = 0.5;
    this.tolerance = 0.05;
    this.maxAdjustment = 0.3;
  }

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
                  isBot: true
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

  calculatePerformanceMetrics(games, playerId) {
    if (games.length === 0) {
      return this.getDefaultPerformance();
    }

    const results = games.map(game => {
      const playerParticipant = game.participants.find(p => p.userId === playerId);
      const isWin = playerParticipant && playerParticipant.position === 1;
      const opponentIsBot = game.participants.some(p => 
        p.userId !== playerId && p.user.isBot
      );

      return {
        won: isWin,
        againstBot: opponentIsBot,
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

    const trend = this.calculateTrend(results);
    const consistency = this.calculateConsistency(results);

    return {
      totalGames,
      winRate,
      botWinRate,
      trend,
      consistency,
      shouldAdjust: totalGames >= 5,
      adjustmentNeeded: this.determineAdjustment(botWinRate, totalGames)
    };
  }

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

  determineAdjustment(currentWinRate, gamesPlayed) {
    if (gamesPlayed < 5) {
      return { needed: false, factor: 1.0 };
    }

    const deviation = currentWinRate - this.targetWinRate;

    if (Math.abs(deviation) <= this.tolerance) {
      return { needed: false, factor: 1.0 };
    }

    const adjustmentMagnitude = Math.min(
      Math.abs(deviation) * 0.5,
      this.maxAdjustment
    );

    if (deviation > this.tolerance) {
      return {
        needed: true,
        factor: 1 - adjustmentMagnitude,
        reason: 'bot_too_easy'
      };
    } else {
      return {
        needed: true,
        factor: 1 + adjustmentMagnitude,
        reason: 'bot_too_hard'
      };
    }
  }

  async getDynamicDifficulty(botId, humanPlayerId) {
    const performance = await this.analyzePlayerPerformance(botId);
    const humanPerformance = await this.analyzePlayerPerformance(humanPlayerId);

    if (!performance.shouldAdjust) {
      return this.getBaseDifficulty(humanPerformance);
    }

    const adjustment = performance.adjustmentNeeded;
    const baseDifficulty = this.getBaseDifficulty(humanPerformance);

    if (!adjustment.needed) {
      return baseDifficulty;
    }

    const history = this.getAdjustmentHistory(botId);
    const smoothedFactor = this.smoothAdjustment(
      adjustment.factor,
      history
    );

    this.recordAdjustment(botId, smoothedFactor, adjustment.reason);

    return {
      ...baseDifficulty,
      performanceFactor: smoothedFactor,
      adjustmentReason: adjustment.reason
    };
  }

  getBaseDifficulty(humanPerformance) {
    const skillMapping = {
      novice: { base: 0.3, variance: 0.2 },
      intermediate: { base: 0.5, variance: 0.15 },
      advanced: { base: 0.7, variance: 0.1 },
      expert: { base: 0.9, variance: 0.05 }
    };

    let skillLevel = 'intermediate';

    if (humanPerformance.winRate < 0.3) {
      skillLevel = 'novice';
    } else if (humanPerformance.winRate > 0.7) {
      skillLevel = humanPerformance.consistency === 'balanced' ? 'expert' : 'advanced';
    } else if (humanPerformance.winRate > 0.5) {
      skillLevel = 'advanced';
    }

    const skill = skillMapping[skillLevel];

    return {
      baseSkill: skill.base,
      variance: skill.variance,
      performanceFactor: 1.0,
      profile: this.selectBehaviorProfile(humanPerformance)
    };
  }

  selectBehaviorProfile(performance) {
    if (performance.consistency === 'streaky') {
      return performance.trend === 'improving' ? 'adaptive' : 'challenging';
    }

    if (performance.consistency === 'alternating') {
      return 'balanced';
    }

    return performance.winRate > 0.6 ? 'competitive' : 'supportive';
  }

  smoothAdjustment(newFactor, history) {
    if (history.length === 0) {
      return newFactor;
    }

    const recentFactors = history.slice(-3).map(h => h.factor);
    const avgRecent = recentFactors.reduce((a, b) => a + b, 0) / recentFactors.length;

    const maxChange = 0.1;
    const proposedChange = newFactor - avgRecent;

    if (Math.abs(proposedChange) > maxChange) {
      return avgRecent + (Math.sign(proposedChange) * maxChange);
    }

    return newFactor;
  }

  getAdjustmentHistory(botId) {
    if (!this.adjustmentHistory.has(botId)) {
      this.adjustmentHistory.set(botId, []);
    }
    return this.adjustmentHistory.get(botId);
  }

  recordAdjustment(botId, factor, reason) {
    const history = this.getAdjustmentHistory(botId);
    
    history.push({
      factor,
      reason,
      timestamp: Date.now()
    });

    if (history.length > 20) {
      history.shift();
    }
  }

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
      }

      if (this.globalMetrics.totalGames % 100 === 0) {
        await this.analyzeGlobalBalance();
      }

    } catch (error) {
      logger.error('Failed to record game outcome:', error);
    }
  }

  async analyzeGlobalBalance() {
    const globalWinRate = this.globalMetrics.humanWins / this.globalMetrics.totalGames;
    
    logger.info('Global performance metrics:', {
      totalGames: this.globalMetrics.totalGames,
      humanWinRate: globalWinRate.toFixed(3),
      deviation: Math.abs(globalWinRate - 0.5).toFixed(3)
    });

    if (Math.abs(globalWinRate - 0.5) > 0.1) {
      logger.warn('Global win rate imbalance detected:', {
        humanWinRate: globalWinRate,
        adjustment: 'recommended'
      });
    }
  }

  getDefaultPerformance() {
    return {
      totalGames: 0,
      winRate: 0.5,
      botWinRate: 0.5,
      trend: 'stable',
      consistency: 'balanced',
      shouldAdjust: false,
      adjustmentNeeded: { needed: false, factor: 1.0 }
    };
  }

  resetCache(playerId = null) {
    if (playerId) {
      this.performanceCache.delete(playerId);
      this.adjustmentHistory.delete(playerId);
    } else {
      this.performanceCache.clear();
      this.adjustmentHistory.clear();
    }
  }
}

module.exports = new PerformanceBalancer();