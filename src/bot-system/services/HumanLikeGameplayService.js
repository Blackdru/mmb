const logger = require('../../config/logger');

class HumanLikeGameplayService {
  constructor() {
    this.playerSessions = new Map();
    this.memoryRetention = new Map();
    this.performanceTracking = new Map();
    
    this.initializeBehaviorProfiles();
  }

  initializeBehaviorProfiles() {
    this.profiles = {
      casual: {
        reactionTimeRange: [1200, 3800],
        memoryAccuracy: 0.65,
        patternPreference: 'random',
        mistakeRate: 0.18,
        focusDuration: 8000
      },
      focused: {
        reactionTimeRange: [800, 2200],
        memoryAccuracy: 0.85,
        patternPreference: 'systematic',
        mistakeRate: 0.08,
        focusDuration: 15000
      },
      tired: {
        reactionTimeRange: [2000, 4500],
        memoryAccuracy: 0.45,
        patternPreference: 'erratic',
        mistakeRate: 0.25,
        focusDuration: 5000
      },
      competitive: {
        reactionTimeRange: [600, 1800],
        memoryAccuracy: 0.92,
        patternPreference: 'optimal',
        mistakeRate: 0.05,
        focusDuration: 20000
      }
    };

    this.timeOfDayFactors = {
      morning: { speed: 0.9, accuracy: 1.1 },
      afternoon: { speed: 1.0, accuracy: 1.0 },
      evening: { speed: 1.1, accuracy: 0.95 },
      night: { speed: 1.2, accuracy: 0.85 }
    };
  }

  async processGameTurn(gameState, playerId) {
    const session = this.getOrCreateSession(playerId);
    const profile = this.selectDynamicProfile(session);
    const boardAnalysis = this.analyzeCurrentBoard(gameState);
    
    session.turnCount++;
    session.lastActionTime = Date.now();
    
    const decision = await this.makeStrategicDecision(
      boardAnalysis,
      session,
      profile,
      gameState
    );
    
    this.updateSessionMetrics(session, decision);
    
    return decision;
  }

  getOrCreateSession(playerId) {
    if (!this.playerSessions.has(playerId)) {
      this.playerSessions.set(playerId, {
        playerId,
        startTime: Date.now(),
        turnCount: 0,
        successfulMatches: 0,
        recentMoves: [],
        currentStreak: 0,
        performanceHistory: [],
        lastActionTime: Date.now(),
        memoryMap: new Map(),
        explorationPattern: this.generateExplorationPattern()
      });
    }
    return this.playerSessions.get(playerId);
  }

  selectDynamicProfile(session) {
    const timePlayed = Date.now() - session.startTime;
    const recentPerformance = this.calculateRecentPerformance(session);
    const timeOfDay = this.getCurrentTimeOfDay();
    
    if (timePlayed < 30000 && session.turnCount < 5) {
      return 'focused';
    } else if (timePlayed > 180000 || session.turnCount > 40) {
      return 'tired';
    } else if (recentPerformance > 0.7) {
      return 'competitive';
    } else {
      return 'casual';
    }
  }

  analyzeCurrentBoard(gameState) {
    // Handle both string and object board states
    const board = typeof gameState.board === 'string' ? JSON.parse(gameState.board) : gameState.board;
    const analysis = {
      totalCards: board.length,
      matchedCards: board.filter(card => card.isMatched).length,
      availableCards: [],
      cardDistribution: new Map(),
      progressPercentage: 0
    };
    
    board.forEach((card, index) => {
      if (!card.isMatched && !card.isFlipped) {
        analysis.availableCards.push(index);
        
        const value = card.symbol; // Use symbol instead of value
        if (!analysis.cardDistribution.has(value)) {
          analysis.cardDistribution.set(value, []);
        }
        analysis.cardDistribution.get(value).push(index);
      }
    });
    
    analysis.progressPercentage = (analysis.matchedCards / analysis.totalCards) * 100;
    
    return analysis;
  }

  async makeStrategicDecision(boardAnalysis, session, profileType, gameState) {
    const profile = this.profiles[profileType];
    const timeFactors = this.timeOfDayFactors[this.getCurrentTimeOfDay()];
    
    const adjustedReactionTime = this.calculateReactionTime(
      profile.reactionTimeRange,
      timeFactors.speed,
      session.turnCount
    );
    
    // Ensure we have available cards to select from
    if (boardAnalysis.availableCards.length === 0) {
      logger.warn(`No available cards for bot selection in game ${gameState.id}`);
      return null;
    }
    
    const memoryCheck = this.consultMemory(
      session.memoryMap,
      boardAnalysis.availableCards,
      profile.memoryAccuracy * timeFactors.accuracy
    );
    
    let selectedIndex;
    
    if (memoryCheck.foundPair && Math.random() < profile.memoryAccuracy) {
      selectedIndex = memoryCheck.cardIndex;
    } else {
      selectedIndex = this.selectByPattern(
        boardAnalysis.availableCards,
        session.explorationPattern,
        profile.patternPreference,
        session.recentMoves
      );
    }
    
    // Validate selected index
    if (selectedIndex === undefined || selectedIndex === null || !boardAnalysis.availableCards.includes(selectedIndex)) {
      logger.warn(`Invalid card selection ${selectedIndex}, falling back to random selection`);
      selectedIndex = boardAnalysis.availableCards[Math.floor(Math.random() * boardAnalysis.availableCards.length)];
    }
    
    if (Math.random() < profile.mistakeRate) {
      const mistake = this.introduceMistake(selectedIndex, boardAnalysis.availableCards);
      if (boardAnalysis.availableCards.includes(mistake)) {
        selectedIndex = mistake;
      }
    }
    
    const hesitation = this.calculateHesitation(session, profile);
    
    return {
      cardIndex: selectedIndex,
      reactionTime: adjustedReactionTime + hesitation,
      confidence: this.calculateConfidence(memoryCheck, profile),
      isMemoryBased: memoryCheck.foundPair
    };
  }

  calculateReactionTime(baseRange, speedFactor, turnCount) {
    const [min, max] = baseRange;
    const fatigueFactor = 1 + (turnCount * 0.01);
    const variance = Math.random() * (max - min) + min;
    
    return Math.floor(variance * speedFactor * fatigueFactor);
  }

  consultMemory(memoryMap, availableCards, accuracy) {
    const knownPairs = new Map();
    
    for (const [index, value] of memoryMap) {
      if (!knownPairs.has(value)) {
        knownPairs.set(value, []);
      }
      knownPairs.get(value).push(index);
    }
    
    for (const [value, indices] of knownPairs) {
      const availableIndices = indices.filter(idx => availableCards.includes(idx));
      if (availableIndices.length >= 2 && Math.random() < accuracy) {
        return {
          foundPair: true,
          cardIndex: availableIndices[0],
          matchIndex: availableIndices[1]
        };
      }
    }
    
    const rememberedCards = Array.from(memoryMap.keys())
      .filter(idx => availableCards.includes(idx));
    
    if (rememberedCards.length > 0 && Math.random() < accuracy * 0.7) {
      return {
        foundPair: false,
        cardIndex: rememberedCards[Math.floor(Math.random() * rememberedCards.length)]
      };
    }
    
    return { foundPair: false, cardIndex: null };
  }

  selectByPattern(availableCards, explorationPattern, preference, recentMoves) {
    // Ensure we have cards to select from
    if (availableCards.length === 0) {
      logger.warn('No available cards for pattern selection');
      return null;
    }
    
    const unexplored = availableCards.filter(idx => 
      !recentMoves.some(move => move.index === idx)
    );
    
    switch (preference) {
      case 'systematic':
        return this.systematicSelection(availableCards, explorationPattern);
      
      case 'optimal':
        return this.optimalSelection(availableCards, unexplored);
      
      case 'erratic':
        return availableCards[Math.floor(Math.random() * availableCards.length)];
      
      default:
        if (unexplored.length > 0 && Math.random() < 0.7) {
          return unexplored[Math.floor(Math.random() * unexplored.length)];
        }
        return availableCards[Math.floor(Math.random() * availableCards.length)];
    }
  }

  systematicSelection(availableCards, pattern) {
    for (const position of pattern) {
      if (availableCards.includes(position)) {
        return position;
      }
    }
    return availableCards[0];
  }

  optimalSelection(availableCards, unexplored) {
    const gridSize = 4;
    const centerPositions = [5, 6, 9, 10];
    const cornerPositions = [0, 3, 12, 15];
    
    const centerAvailable = centerPositions.filter(pos => unexplored.includes(pos));
    if (centerAvailable.length > 0) {
      return centerAvailable[Math.floor(Math.random() * centerAvailable.length)];
    }
    
    const cornerAvailable = cornerPositions.filter(pos => unexplored.includes(pos));
    if (cornerAvailable.length > 0) {
      return cornerAvailable[Math.floor(Math.random() * cornerAvailable.length)];
    }
    
    return unexplored.length > 0 
      ? unexplored[Math.floor(Math.random() * unexplored.length)]
      : availableCards[Math.floor(Math.random() * availableCards.length)];
  }

  introduceMistake(intendedIndex, availableCards) {
    const adjacentPositions = this.getAdjacentPositions(intendedIndex);
    const validAdjacent = adjacentPositions.filter(pos => availableCards.includes(pos));
    
    if (validAdjacent.length > 0 && Math.random() < 0.6) {
      return validAdjacent[Math.floor(Math.random() * validAdjacent.length)];
    }
    
    return availableCards[Math.floor(Math.random() * availableCards.length)];
  }

  getAdjacentPositions(index) {
    const row = Math.floor(index / 4);
    const col = index % 4;
    const positions = [];
    
    const offsets = [[-1,0], [1,0], [0,-1], [0,1]];
    
    for (const [dr, dc] of offsets) {
      const newRow = row + dr;
      const newCol = col + dc;
      if (newRow >= 0 && newRow < 4 && newCol >= 0 && newCol < 4) {
        positions.push(newRow * 4 + newCol);
      }
    }
    
    return positions;
  }

  calculateHesitation(session, profile) {
    const consecutiveSuccesses = session.currentStreak;
    const pressureFactor = Math.min(consecutiveSuccesses * 0.1, 0.5);
    
    if (Math.random() < 0.15 + pressureFactor) {
      return Math.floor(Math.random() * 800 + 400);
    }
    
    return 0;
  }

  calculateConfidence(memoryCheck, profile) {
    if (memoryCheck.foundPair) {
      return 0.85 + Math.random() * 0.15;
    }
    
    return 0.3 + Math.random() * 0.4;
  }

  updateSessionMetrics(session, decision) {
    session.recentMoves.push({
      index: decision.cardIndex,
      timestamp: Date.now(),
      wasMemoryBased: decision.isMemoryBased
    });
    
    if (session.recentMoves.length > 20) {
      session.recentMoves.shift();
    }
    
    session.performanceHistory.push({
      reactionTime: decision.reactionTime,
      confidence: decision.confidence,
      timestamp: Date.now()
    });
    
    if (session.performanceHistory.length > 50) {
      session.performanceHistory.shift();
    }
  }

  updateMemory(playerId, revealedCards, wasSuccessful) {
    const session = this.playerSessions.get(playerId);
    if (!session) return;
    
    const profile = this.profiles[this.selectDynamicProfile(session)];
    const retentionChance = wasSuccessful 
      ? profile.memoryAccuracy 
      : profile.memoryAccuracy * 0.7;
    
    // Handle both array and object format for revealed cards
    const cardsToProcess = Array.isArray(revealedCards) ? revealedCards : [revealedCards];
    
    cardsToProcess.forEach(card => {
      if (Math.random() < retentionChance) {
        // Handle different card data structures
        const index = card.index !== undefined ? card.index : card.position;
        const value = card.value !== undefined ? card.value : card.symbol;
        
        if (index !== undefined && value !== undefined) {
          session.memoryMap.set(index, value);
          logger.debug(`Bot ${playerId} remembered card at position ${index} with value ${value}`);
        }
      }
    });
    
    // Occasional memory forgetting for realism
    if (Math.random() < (1 - profile.memoryAccuracy) * 0.3) {
      const keysToForget = Array.from(session.memoryMap.keys());
      if (keysToForget.length > 0) {
        const forgetIndex = keysToForget[Math.floor(Math.random() * keysToForget.length)];
        session.memoryMap.delete(forgetIndex);
        logger.debug(`Bot ${playerId} forgot card at position ${forgetIndex}`);
      }
    }
    
    if (wasSuccessful) {
      session.currentStreak++;
      session.successfulMatches++;
    } else {
      session.currentStreak = 0;
    }
  }

  calculateRecentPerformance(session) {
    if (session.turnCount === 0) return 0.5;
    
    const recentTurns = Math.min(session.turnCount, 10);
    const successRate = session.successfulMatches / recentTurns;
    
    return Math.min(successRate, 1.0);
  }

  getCurrentTimeOfDay() {
    const hour = new Date().getHours();
    
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
  }

  generateExplorationPattern() {
    const positions = Array.from({ length: 16 }, (_, i) => i);
    
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    
    return positions;
  }

  cleanupSession(playerId) {
    this.playerSessions.delete(playerId);
    this.memoryRetention.delete(playerId);
    this.performanceTracking.delete(playerId);
  }

  async getPerformanceAdjustment(playerId) {
    if (!this.performanceTracking.has(playerId)) {
      this.performanceTracking.set(playerId, {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        lastTenGames: []
      });
    }
    
    const tracking = this.performanceTracking.get(playerId);
    const recentGames = tracking.lastTenGames.slice(-10);
    
    if (recentGames.length < 5) {
      return { adjustmentFactor: 1.0, strategy: 'neutral' };
    }
    
    const recentWinRate = recentGames.filter(g => g.won).length / recentGames.length;
    
    if (recentWinRate < 0.4) {
      return { adjustmentFactor: 1.2, strategy: 'boost' };
    } else if (recentWinRate > 0.6) {
      return { adjustmentFactor: 0.8, strategy: 'throttle' };
    }
    
    return { adjustmentFactor: 1.0, strategy: 'neutral' };
  }

  recordGameResult(playerId, won) {
    const tracking = this.performanceTracking.get(playerId) || {
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      lastTenGames: []
    };
    
    tracking.gamesPlayed++;
    if (won) {
      tracking.wins++;
    } else {
      tracking.losses++;
    }
    
    tracking.lastTenGames.push({
      won,
      timestamp: Date.now()
    });
    
    if (tracking.lastTenGames.length > 10) {
      tracking.lastTenGames.shift();
    }
    
    this.performanceTracking.set(playerId, tracking);
  }
}

module.exports = new HumanLikeGameplayService();