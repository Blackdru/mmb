const HumanLikeGameplayService = require('./HumanLikeGameplayService');
const PerformanceBalancer = require('./PerformanceBalancer');
const logger = require('../../config/logger');

class GameplayController {
  constructor() {
    this.activeSessions = new Map();
    this.moveQueue = new Map();
    this.naturalBehaviors = this.initializeNaturalBehaviors();
  }

  initializeNaturalBehaviors() {
    return {
      mouseMovement: {
        straight: 0.4,
        curved: 0.35,
        hesitant: 0.25
      },
      clickPatterns: {
        single: 0.7,
        doubleCheck: 0.2,
        misclick: 0.1
      },
      distractions: {
        none: 0.6,
        brief: 0.3,
        extended: 0.1
      }
    };
  }

  async initiateBotTurn(gameState, botId, memoryGameService) {
    try {
      const sessionKey = `${gameState.id}_${botId}`;
      
      if (this.activeSessions.has(sessionKey)) {
        logger.warn(`Bot ${botId} already has active session for game ${gameState.id}`);
        return;
      }

      this.activeSessions.set(sessionKey, {
        startTime: Date.now(),
        gameId: gameState.id,
        botId,
        moveCount: 0,
        cardsSelected: 0
      });

      const humanOpponent = gameState.participants.find(p => p.userId !== botId);
      const difficulty = humanOpponent ? 
        await PerformanceBalancer.getDynamicDifficulty(botId, humanOpponent.userId) :
        { performanceFactor: 1.0, profile: 'casual' };

      // Execute bot turn - select first card
      await this.executeBotTurn(gameState, botId, difficulty, memoryGameService);

    } catch (error) {
      logger.error(`Bot turn initiation failed for ${botId}:`, error);
      this.cleanupSession(gameState.id, botId);
    }
  }

  async executeBotTurn(gameState, botId, difficulty, memoryGameService) {
    try {
      // Get first card decision
      const firstDecision = await HumanLikeGameplayService.processGameTurn(gameState, botId);
      
      if (!firstDecision || firstDecision.cardIndex === undefined) {
        logger.error(`Bot ${botId} failed to make first card decision`);
        return;
      }

      // Add natural delay before first card
      const firstDelay = this.calculateNaturalDelay(difficulty);
      await this.delay(firstDelay);

      // Select first card
      await this.executeCardSelection(memoryGameService, gameState.id, botId, firstDecision.cardIndex);
      
      // Wait for game state to update, then select second card
      setTimeout(async () => {
        try {
          // Get updated game state
          const updatedGameState = memoryGameService.games.get(gameState.id);
          if (!updatedGameState || updatedGameState.currentTurnPlayerId !== botId) {
            logger.warn(`Bot ${botId} turn ended or game state invalid after first card`);
            return;
          }

          // If already selected 2 cards, the turn is complete
          if (updatedGameState.selectedCards.length >= 2) {
            logger.info(`Bot ${botId} turn completed with 2 cards`);
            return;
          }

          // Get second card decision
          const secondDecision = await HumanLikeGameplayService.processGameTurn(updatedGameState, botId);
          
          if (!secondDecision || secondDecision.cardIndex === undefined) {
            logger.error(`Bot ${botId} failed to make second card decision`);
            return;
          }

          // Add natural delay before second card
          const secondDelay = this.calculateNaturalDelay(difficulty);
          await this.delay(secondDelay);

          // Select second card
          await this.executeCardSelection(memoryGameService, gameState.id, botId, secondDecision.cardIndex);
          
          this.updateSession(gameState.id, botId);
        } catch (error) {
          logger.error(`Bot ${botId} second card selection failed:`, error);
        }
      }, 300 + Math.random() * 700); // 300-1000ms delay between cards

    } catch (error) {
      logger.error(`Bot turn execution failed for ${botId}:`, error);
      this.cleanupSession(gameState.id, botId);
    }
  }

  calculateNaturalDelay(difficulty) {
    const baseDelay = 800; // Base delay in ms
    const variance = 600; // Random variance
    const speedFactor = difficulty.performanceFactor || 1.0;
    
    return Math.floor((baseDelay + Math.random() * variance) / speedFactor);
  }

  async executeNaturalMove(decision, gameState, botId, difficulty, memoryGameService) {
    const moveSequence = this.generateMoveSequence(decision, difficulty);
    
    for (const action of moveSequence) {
      await this.performAction(action, gameState, botId, memoryGameService);
    }

    this.updateSession(gameState.id, botId);
  }

  generateMoveSequence(decision, difficulty) {
    const sequence = [];
    const behavior = this.selectBehaviorPattern(difficulty);

    if (behavior.hasDistraction) {
      sequence.push({
        type: 'distraction',
        duration: this.calculateDistractionTime(behavior.distractionLevel)
      });
    }

    if (behavior.mousePattern === 'hesitant' && Math.random() < 0.3) {
      sequence.push({
        type: 'hover',
        targetIndex: this.selectAlternativeCard(decision.cardIndex),
        duration: 400 + Math.random() * 600
      });
    }

    sequence.push({
      type: 'move_to_card',
      targetIndex: decision.cardIndex,
      pattern: behavior.mousePattern,
      duration: this.calculateMoveDuration(behavior.mousePattern, difficulty)
    });

    if (behavior.clickPattern === 'doubleCheck') {
      sequence.push({
        type: 'pause',
        duration: 200 + Math.random() * 300
      });
    }

    if (behavior.clickPattern === 'misclick' && Math.random() < 0.5) {
      const nearbyCard = this.getNearbyCard(decision.cardIndex);
      sequence.push({
        type: 'click',
        targetIndex: nearbyCard,
        immediate: true
      });
      sequence.push({
        type: 'pause',
        duration: 100
      });
      sequence.push({
        type: 'move_to_card',
        targetIndex: decision.cardIndex,
        pattern: 'straight',
        duration: 200
      });
    }

    sequence.push({
      type: 'click',
      targetIndex: decision.cardIndex,
      confidence: decision.confidence
    });

    return sequence;
  }

  selectBehaviorPattern(difficulty) {
    const roll = Math.random();
    
    let mousePattern = 'straight';
    if (roll < this.naturalBehaviors.mouseMovement.curved + this.naturalBehaviors.mouseMovement.hesitant) {
      mousePattern = roll < this.naturalBehaviors.mouseMovement.curved ? 'curved' : 'hesitant';
    }

    const clickRoll = Math.random();
    let clickPattern = 'single';
    if (clickRoll > this.naturalBehaviors.clickPatterns.single) {
      clickPattern = clickRoll < this.naturalBehaviors.clickPatterns.single + this.naturalBehaviors.clickPatterns.doubleCheck 
        ? 'doubleCheck' 
        : 'misclick';
    }

    const distractionRoll = Math.random();
    let hasDistraction = distractionRoll > this.naturalBehaviors.distractions.none;
    let distractionLevel = hasDistraction 
      ? (distractionRoll < this.naturalBehaviors.distractions.none + this.naturalBehaviors.distractions.brief ? 'brief' : 'extended')
      : 'none';

    if (difficulty.performanceFactor > 1.2) {
      mousePattern = 'straight';
      clickPattern = 'single';
      hasDistraction = false;
    }

    return {
      mousePattern,
      clickPattern,
      hasDistraction,
      distractionLevel
    };
  }

  calculateDistractionTime(level) {
    const times = {
      brief: [500, 1500],
      extended: [2000, 4000]
    };
    
    const [min, max] = times[level] || times.brief;
    return Math.floor(Math.random() * (max - min) + min);
  }

  calculateMoveDuration(pattern, difficulty) {
    const baseTimes = {
      straight: [300, 600],
      curved: [400, 800],
      hesitant: [600, 1200]
    };

    const [min, max] = baseTimes[pattern];
    const speedFactor = 2 - difficulty.performanceFactor;
    
    return Math.floor((Math.random() * (max - min) + min) * speedFactor);
  }

  selectAlternativeCard(targetIndex) {
    const offsets = [-4, -1, 1, 4];
    const alternatives = offsets
      .map(offset => targetIndex + offset)
      .filter(idx => idx >= 0 && idx < 16 && idx !== targetIndex);
    
    return alternatives[Math.floor(Math.random() * alternatives.length)] || targetIndex;
  }

  getNearbyCard(targetIndex) {
    const row = Math.floor(targetIndex / 4);
    const col = targetIndex % 4;
    
    const nearby = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const newRow = row + dr;
        const newCol = col + dc;
        if (newRow >= 0 && newRow < 4 && newCol >= 0 && newCol < 4) {
          nearby.push(newRow * 4 + newCol);
        }
      }
    }
    
    return nearby[Math.floor(Math.random() * nearby.length)] || targetIndex;
  }

  async performAction(action, gameState, botId, memoryGameService) {
    await this.delay(action.duration || 0);

    switch (action.type) {
      case 'click':
        await this.executeCardSelection(
          memoryGameService,
          gameState.id,
          botId,
          action.targetIndex
        );
        break;
        
      case 'distraction':
      case 'pause':
      case 'hover':
      case 'move_to_card':
        // These are timing actions, already handled by delay
        break;
    }
  }

  async executeCardSelection(memoryGameService, gameId, botId, cardIndex) {
    try {
      // Create mock socket object for bot
      const mockSocket = {
        user: { id: botId },
        emit: () => {} // Bot doesn't need socket responses
      };

      const selectionData = {
        gameId: gameId,
        playerId: botId,
        position: cardIndex
      };

      // Call the actual MemoryGame selectCard method
      await memoryGameService.selectCard(mockSocket, selectionData);
      
      logger.info(`🤖 Advanced bot ${botId} selected card ${cardIndex} in game ${gameId}`);
    } catch (error) {
      logger.error(`Bot card selection failed: ${error.message}`);
      throw error;
    }
  }

  updateSession(gameId, botId) {
    const sessionKey = `${gameId}_${botId}`;
    const session = this.activeSessions.get(sessionKey);
    
    if (session) {
      session.moveCount++;
      session.lastMoveTime = Date.now();
    }
  }

  cleanupSession(gameId, botId) {
    const sessionKey = `${gameId}_${botId}`;
    this.activeSessions.delete(sessionKey);
    this.moveQueue.delete(sessionKey);
  }

  async handleCardReveal(gameId, botId, revealedCards, wasMatch) {
    await HumanLikeGameplayService.updateMemory(
      botId,
      revealedCards,
      wasMatch
    );

    if (wasMatch && Math.random() < 0.15) {
      await this.delay(200 + Math.random() * 300);
    }
  }

  async handleGameEnd(gameId, winnerId, participants) {
    for (const participant of participants) {
      if (participant.user.isBot) {
        HumanLikeGameplayService.recordGameResult(
          participant.userId,
          winnerId === participant.userId
        );
        
        this.cleanupSession(gameId, participant.userId);
      }
    }

    await PerformanceBalancer.recordGameOutcome(gameId, winnerId, participants);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getSessionMetrics(gameId, botId) {
    const sessionKey = `${gameId}_${botId}`;
    const session = this.activeSessions.get(sessionKey);
    
    if (!session) {
      return null;
    }

    const duration = Date.now() - session.startTime;
    const avgMoveTime = duration / Math.max(session.moveCount, 1);

    return {
      gameId,
      botId,
      duration,
      moveCount: session.moveCount,
      avgMoveTime,
      active: true
    };
  }
}

module.exports = new GameplayController();