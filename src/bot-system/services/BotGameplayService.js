const logger = require('../../config/logger');
const prisma = require('../../config/database');
const botService = require('../../services/BotService');

class BotGameplayService {
  constructor() {
    this.botMemory = new Map(); // Store bot memory for each game
    this.botDecisionHistory = new Map(); // Track bot decision patterns
  }

  // Check if current player is a bot and handle bot turn with human-like behavior
  async checkAndHandleBotTurn(gameState, playerId, selectCardCallback) {
    try {
      const user = await prisma.user.findUnique({ where: { id: playerId } });
      if (user && user.isBot) {
        const botConfig = botService.getBotGameplayConfig(playerId);
        logger.info(`🤖 Bot turn detected for ${user.name} (${botConfig.name}) in game ${gameState.id}`);
        
        // Calculate human-like thinking time based on bot type
        const thinkingTime = this.calculateThinkingTime(botConfig);
        
        // Handle bot turn with human-like delay
        setTimeout(() => {
          this.handleIntelligentBotTurn(gameState, playerId, selectCardCallback, botConfig);
        }, thinkingTime);
      }
    } catch (error) {
      logger.error(`Error checking bot turn for player ${playerId}:`, error);
    }
  }

  // Calculate human-like thinking time based on bot configuration
  calculateThinkingTime(botConfig) {
    const { thinkingTimeMin, thinkingTimeMax } = botConfig.humanBehavior;
    const baseTime = thinkingTimeMin + Math.random() * (thinkingTimeMax - thinkingTimeMin);
    
    // Add some variability to make it more human-like
    const variability = 0.2; // 20% variability
    const variation = (Math.random() - 0.5) * 2 * variability;
    
    return Math.max(500, baseTime * (1 + variation));
  }

  // Intelligent bot logic with human-like behavior and winning strategies
  async handleIntelligentBotTurn(gameState, botPlayerId, selectCardCallback, botConfig) {
    try {
      if (!gameState || gameState.status !== 'playing' || gameState.currentTurnPlayerId !== botPlayerId) {
        return;
      }

      // Get or initialize bot memory for this game
      const botMemoryKey = `${gameState.id}_${botPlayerId}`;
      const memory = this.getBotMemory(botMemoryKey, botConfig);

      // Parse game board
      const board = JSON.parse(gameState.board);
      const availableIndices = this.getAvailableCardIndices(board, gameState.selectedCards);
      
      if (availableIndices.length === 0) return;

      // Intelligent card selection based on bot type
      const { firstCardIndex, strategy } = await this.selectFirstCard(availableIndices, memory, botConfig, board);
      
      logger.info(`🤖 Bot ${botPlayerId} (${botConfig.name}) selecting first card at index ${firstCardIndex} using ${strategy} strategy`);
      
      // Record decision for pattern tracking
      this.recordBotDecision(botPlayerId, 'first_card', { index: firstCardIndex, strategy });
      
      await selectCardCallback({
        gameId: gameState.id,
        playerId: botPlayerId,
        cardIndex: firstCardIndex
      });
      
      // Calculate delay for second card selection (human-like behavior)
      const secondCardDelay = this.calculateSecondCardDelay(botConfig);
      
      setTimeout(async () => {
        try {
          // Get updated game state
          const updatedGameState = this.getUpdatedGameState(gameState.id);
          if (!updatedGameState || updatedGameState.currentTurnPlayerId !== botPlayerId) {
            return;
          }

          // Select second card intelligently
          const secondCardIndex = await this.selectSecondCard(
            firstCardIndex, 
            availableIndices, 
            memory, 
            botConfig, 
            board
          );

          logger.info(`🤖 Bot ${botPlayerId} selecting second card at index ${secondCardIndex}`);
          
          // Record second card decision
          this.recordBotDecision(botPlayerId, 'second_card', { index: secondCardIndex });
          
          await selectCardCallback({
            gameId: gameState.id,
            playerId: botPlayerId,
            cardIndex: secondCardIndex
          });

          // Update bot memory with revealed cards
          this.updateBotMemoryAfterTurn(memory, board, firstCardIndex, secondCardIndex, botConfig);
          
        } catch (error) {
          logger.error(`Error in bot second card selection:`, error);
        }
      }, secondCardDelay);
      
    } catch (error) {
      logger.error(`Error in intelligent bot turn for ${botPlayerId}:`, error);
    }
  }

  // Get or initialize bot memory
  getBotMemory(botMemoryKey, botConfig) {
    if (!this.botMemory.has(botMemoryKey)) {
      this.botMemory.set(botMemoryKey, {
        knownCards: new Map(), // position -> symbol
        matchedPairs: new Set(),
        turnCount: 0,
        successfulMatches: 0,
        failedAttempts: 0,
        lastStrategy: null,
        confidence: 0.5,
        adaptiveState: {
          explorationPhase: true,
          memoryPhase: false,
          aggressivePhase: false
        }
      });
    }
    return this.botMemory.get(botMemoryKey);
  }

  // Get available card indices
  getAvailableCardIndices(board, selectedCards) {
    const selectedIndices = selectedCards.map(card => card.index);
    return board
      .map((card, index) => ({ card, index }))
      .filter(({ card, index }) => !card.matched && !selectedIndices.includes(index))
      .map(({ index }) => index);
  }

  // Intelligent first card selection
  async selectFirstCard(availableIndices, memory, botConfig, board) {
    const { intelligence, winProbability, humanBehavior } = botConfig;
    
    // Check if bot should make a strategic move or a human-like mistake
    const shouldMakeMistake = Math.random() < humanBehavior.mistakeProbability;
    
    if (shouldMakeMistake) {
      // Make a human-like mistake occasionally
      return {
        firstCardIndex: availableIndices[Math.floor(Math.random() * availableIndices.length)],
        strategy: 'human_mistake'
      };
    }

    // Try to find a known matching pair first (memory strategy)
    const memoryMatch = this.findMemoryMatch(memory, availableIndices, board);
    if (memoryMatch && Math.random() < humanBehavior.memoryAccuracy) {
      return {
        firstCardIndex: memoryMatch.firstCard,
        strategy: 'memory_match'
      };
    }

    // Intelligent strategies based on bot type
    switch (intelligence) {
      case 'strategic':
        return this.strategicFirstCardSelection(availableIndices, memory, botConfig, board);
      
      case 'analytical':
        return this.analyticalFirstCardSelection(availableIndices, memory, botConfig, board);
      
      case 'tactical':
        return this.tacticalFirstCardSelection(availableIndices, memory, botConfig, board);
      
      case 'adaptive':
        return this.adaptiveFirstCardSelection(availableIndices, memory, botConfig, board);
      
      case 'intuitive':
        return this.intuitiveFirstCardSelection(availableIndices, memory, botConfig, board);
      
      case 'calculated':
        return this.calculatedFirstCardSelection(availableIndices, memory, botConfig, board);
      
      case 'competitive':
        return this.competitiveFirstCardSelection(availableIndices, memory, botConfig, board);
      
      default:
        return this.casualFirstCardSelection(availableIndices, memory, botConfig, board);
    }
  }

  // Strategic bot first card selection
  strategicFirstCardSelection(availableIndices, memory, botConfig, board) {
    // Strategic bots prefer corner and edge positions for better board coverage
    const cornerPositions = [0, 3, 12, 15]; // Assuming 4x4 grid
    const edgePositions = [1, 2, 4, 7, 8, 11, 13, 14];
    
    const availableCorners = availableIndices.filter(idx => cornerPositions.includes(idx));
    const availableEdges = availableIndices.filter(idx => edgePositions.includes(idx));
    
    if (availableCorners.length > 0 && Math.random() < 0.7) {
      return {
        firstCardIndex: availableCorners[Math.floor(Math.random() * availableCorners.length)],
        strategy: 'strategic_corner'
      };
    } else if (availableEdges.length > 0 && Math.random() < 0.5) {
      return {
        firstCardIndex: availableEdges[Math.floor(Math.random() * availableEdges.length)],
        strategy: 'strategic_edge'
      };
    }
    
    return {
      firstCardIndex: availableIndices[Math.floor(Math.random() * availableIndices.length)],
      strategy: 'strategic_random'
    };
  }

  // Analytical bot first card selection
  analyticalFirstCardSelection(availableIndices, memory, botConfig, board) {
    // Analytical bots analyze patterns and probabilities
    const unexploredCards = availableIndices.filter(idx => !memory.knownCards.has(idx));
    
    if (unexploredCards.length > 0 && Math.random() < 0.8) {
      // Prefer unexplored areas for information gathering
      return {
        firstCardIndex: unexploredCards[Math.floor(Math.random() * unexploredCards.length)],
        strategy: 'analytical_exploration'
      };
    }
    
    return {
      firstCardIndex: availableIndices[Math.floor(Math.random() * availableIndices.length)],
      strategy: 'analytical_calculated'
    };
  }

  // Tactical bot first card selection
  tacticalFirstCardSelection(availableIndices, memory, botConfig, board) {
    // Tactical bots focus on immediate opportunities
    const knownCards = availableIndices.filter(idx => memory.knownCards.has(idx));
    
    if (knownCards.length > 0 && Math.random() < 0.6) {
      return {
        firstCardIndex: knownCards[Math.floor(Math.random() * knownCards.length)],
        strategy: 'tactical_known'
      };
    }
    
    return {
      firstCardIndex: availableIndices[Math.floor(Math.random() * availableIndices.length)],
      strategy: 'tactical_opportunistic'
    };
  }

  // Adaptive bot first card selection
  adaptiveFirstCardSelection(availableIndices, memory, botConfig, board) {
    // Adaptive bots change strategy based on game state
    const gameProgress = memory.turnCount / 20; // Assuming max 20 turns
    
    if (gameProgress < 0.3 && memory.adaptiveState.explorationPhase) {
      // Early game: explore
      const unexplored = availableIndices.filter(idx => !memory.knownCards.has(idx));
      if (unexplored.length > 0) {
        return {
          firstCardIndex: unexplored[Math.floor(Math.random() * unexplored.length)],
          strategy: 'adaptive_exploration'
        };
      }
    } else if (gameProgress > 0.6 && memory.knownCards.size > 4) {
      // Late game: use memory aggressively
      memory.adaptiveState.memoryPhase = true;
      const knownCards = availableIndices.filter(idx => memory.knownCards.has(idx));
      if (knownCards.length > 0) {
        return {
          firstCardIndex: knownCards[Math.floor(Math.random() * knownCards.length)],
          strategy: 'adaptive_memory'
        };
      }
    }
    
    return {
      firstCardIndex: availableIndices[Math.floor(Math.random() * availableIndices.length)],
      strategy: 'adaptive_balanced'
    };
  }

  // Intuitive bot first card selection
  intuitiveFirstCardSelection(availableIndices, memory, botConfig, board) {
    // Intuitive bots make "gut feeling" decisions with some randomness
    const recentlyRevealed = Array.from(memory.knownCards.keys()).slice(-4);
    const nearbyCards = [];
    
    recentlyRevealed.forEach(pos => {
      const adjacent = this.getAdjacentPositions(pos, 4); // 4x4 grid
      adjacent.forEach(adjPos => {
        if (availableIndices.includes(adjPos) && !nearbyCards.includes(adjPos)) {
          nearbyCards.push(adjPos);
        }
      });
    });
    
    if (nearbyCards.length > 0 && Math.random() < 0.4) {
      return {
        firstCardIndex: nearbyCards[Math.floor(Math.random() * nearbyCards.length)],
        strategy: 'intuitive_nearby'
      };
    }
    
    return {
      firstCardIndex: availableIndices[Math.floor(Math.random() * availableIndices.length)],
      strategy: 'intuitive_random'
    };
  }

  // Calculated bot first card selection
  calculatedFirstCardSelection(availableIndices, memory, botConfig, board) {
    // Calculated bots prefer systematic approaches
    const systematicOrder = availableIndices.sort((a, b) => a - b);
    
    if (Math.random() < 0.6) {
      return {
        firstCardIndex: systematicOrder[0],
        strategy: 'calculated_systematic'
      };
    }
    
    return {
      firstCardIndex: availableIndices[Math.floor(Math.random() * availableIndices.length)],
      strategy: 'calculated_random'
    };
  }

  // Competitive bot first card selection
  competitiveFirstCardSelection(availableIndices, memory, botConfig, board) {
    // Competitive bots take risks for higher rewards
    const riskTolerance = botConfig.gameplayStyle.riskTolerance;
    
    if (Math.random() < riskTolerance) {
      // Take a risk on unknown cards
      const unknownCards = availableIndices.filter(idx => !memory.knownCards.has(idx));
      if (unknownCards.length > 0) {
        return {
          firstCardIndex: unknownCards[Math.floor(Math.random() * unknownCards.length)],
          strategy: 'competitive_risk'
        };
      }
    }
    
    return {
      firstCardIndex: availableIndices[Math.floor(Math.random() * availableIndices.length)],
      strategy: 'competitive_safe'
    };
  }

  // Casual bot first card selection
  casualFirstCardSelection(availableIndices, memory, botConfig, board) {
    // Casual bots make mostly random decisions
    return {
      firstCardIndex: availableIndices[Math.floor(Math.random() * availableIndices.length)],
      strategy: 'casual_random'
    };
  }

  // Find memory match for known pairs
  findMemoryMatch(memory, availableIndices, board) {
    const knownCards = memory.knownCards;
    
    for (const [pos1, symbol1] of knownCards) {
      if (!availableIndices.includes(pos1)) continue;
      
      for (const [pos2, symbol2] of knownCards) {
        if (pos1 !== pos2 && symbol1 === symbol2 && availableIndices.includes(pos2)) {
          return { firstCard: pos1, secondCard: pos2, symbol: symbol1 };
        }
      }
    }
    
    return null;
  }

  // Select second card intelligently
  async selectSecondCard(firstCardIndex, availableIndices, memory, botConfig, board) {
    const firstCardSymbol = board[firstCardIndex].symbol;
    
    // Check if we know the matching card
    const matchingCard = this.findMatchingCardInMemory(firstCardSymbol, firstCardIndex, memory, availableIndices);
    
    if (matchingCard && Math.random() < botConfig.humanBehavior.memoryAccuracy) {
      return matchingCard;
    }
    
    // Remove first card from available options
    const remainingIndices = availableIndices.filter(idx => idx !== firstCardIndex);
    
    if (remainingIndices.length === 0) {
      return firstCardIndex; // Fallback
    }
    
    // Intelligent second card selection based on bot type
    return this.selectSecondCardByStrategy(remainingIndices, memory, botConfig, firstCardIndex);
  }

  // Find matching card in memory
  findMatchingCardInMemory(targetSymbol, excludeIndex, memory, availableIndices) {
    for (const [pos, symbol] of memory.knownCards) {
      if (symbol === targetSymbol && pos !== excludeIndex && availableIndices.includes(pos)) {
        return pos;
      }
    }
    return null;
  }

  // Select second card by strategy
  selectSecondCardByStrategy(remainingIndices, memory, botConfig, firstCardIndex) {
    const { intelligence } = botConfig;
    
    switch (intelligence) {
      case 'strategic':
      case 'analytical':
        // Prefer positions that provide maximum information
        return this.selectInformativePosition(remainingIndices, memory);
      
      case 'tactical':
      case 'competitive':
        // Prefer aggressive moves
        return remainingIndices[Math.floor(Math.random() * Math.min(3, remainingIndices.length))];
      
      case 'adaptive':
        // Adapt based on current strategy
        return this.adaptiveSecondCardSelection(remainingIndices, memory, firstCardIndex);
      
      default:
        // Random selection for casual bots
        return remainingIndices[Math.floor(Math.random() * remainingIndices.length)];
    }
  }

  // Select informative position for strategic bots
  selectInformativePosition(remainingIndices, memory) {
    const unknownCards = remainingIndices.filter(idx => !memory.knownCards.has(idx));
    
    if (unknownCards.length > 0 && Math.random() < 0.7) {
      return unknownCards[Math.floor(Math.random() * unknownCards.length)];
    }
    
    return remainingIndices[Math.floor(Math.random() * remainingIndices.length)];
  }

  // Adaptive second card selection
  adaptiveSecondCardSelection(remainingIndices, memory, firstCardIndex) {
    if (memory.adaptiveState.explorationPhase) {
      const unknownCards = remainingIndices.filter(idx => !memory.knownCards.has(idx));
      if (unknownCards.length > 0) {
        return unknownCards[Math.floor(Math.random() * unknownCards.length)];
      }
    }
    
    return remainingIndices[Math.floor(Math.random() * remainingIndices.length)];
  }

  // Calculate second card delay
  calculateSecondCardDelay(botConfig) {
    const baseDelay = 1500; // Base 1.5 seconds
    const intelligenceMultiplier = {
      'strategic': 1.2,
      'analytical': 1.4,
      'tactical': 0.8,
      'adaptive': 1.0,
      'intuitive': 0.7,
      'calculated': 1.3,
      'competitive': 0.6,
      'casual': 0.5,
      'random': 0.4,
      'beginner': 0.8
    };
    
    const multiplier = intelligenceMultiplier[botConfig.intelligence] || 1.0;
    const variation = 0.3; // 30% variation
    const randomFactor = 1 + (Math.random() - 0.5) * 2 * variation;
    
    return Math.max(800, baseDelay * multiplier * randomFactor);
  }

  // Update bot memory after turn
  updateBotMemoryAfterTurn(memory, board, firstCardIndex, secondCardIndex, botConfig) {
    const firstSymbol = board[firstCardIndex].symbol;
    const secondSymbol = board[secondCardIndex].symbol;
    
    // Update memory with revealed cards
    const memoryAccuracy = botConfig.humanBehavior.memoryAccuracy;
    
    if (Math.random() < memoryAccuracy) {
      memory.knownCards.set(firstCardIndex, firstSymbol);
    }
    
    if (Math.random() < memoryAccuracy) {
      memory.knownCards.set(secondCardIndex, secondSymbol);
    }
    
    // Track success/failure
    if (firstSymbol === secondSymbol) {
      memory.successfulMatches++;
      memory.matchedPairs.add(`${firstSymbol}_${Math.min(firstCardIndex, secondCardIndex)}_${Math.max(firstCardIndex, secondCardIndex)}`);
    } else {
      memory.failedAttempts++;
    }
    
    memory.turnCount++;
    
    // Update confidence based on performance
    const successRate = memory.successfulMatches / (memory.successfulMatches + memory.failedAttempts);
    memory.confidence = successRate;
    
    // Occasionally forget cards (human-like behavior)
    if (Math.random() < 0.1) {
      const positions = Array.from(memory.knownCards.keys());
      if (positions.length > 0) {
        const forgetPosition = positions[Math.floor(Math.random() * positions.length)];
        memory.knownCards.delete(forgetPosition);
      }
    }
  }

  // Record bot decision for pattern analysis
  recordBotDecision(botPlayerId, decisionType, data) {
    const key = `${botPlayerId}_decisions`;
    if (!this.botDecisionHistory.has(key)) {
      this.botDecisionHistory.set(key, []);
    }
    
    const history = this.botDecisionHistory.get(key);
    history.push({
      type: decisionType,
      data,
      timestamp: Date.now()
    });
    
    // Keep only last 50 decisions
    if (history.length > 50) {
      history.shift();
    }
  }

  // Get adjacent positions for intuitive bot logic
  getAdjacentPositions(position, gridSize) {
    const row = Math.floor(position / gridSize);
    const col = position % gridSize;
    const adjacent = [];
    
    // Check all 8 directions
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        
        const newRow = row + dr;
        const newCol = col + dc;
        
        if (newRow >= 0 && newRow < gridSize && newCol >= 0 && newCol < gridSize) {
          adjacent.push(newRow * gridSize + newCol);
        }
      }
    }
    
    return adjacent;
  }

  // Get updated game state (placeholder - implement based on your game state management)
  getUpdatedGameState(gameId) {
    // This should return the current game state
    // Implementation depends on how you manage game state
    return null; // Placeholder
  }

  // Update bot memory when cards are revealed (legacy compatibility)
  updateBotMemory(gameId, botPlayerId, revealedCards) {
    const botMemoryKey = `${gameId}_${botPlayerId}`;
    const memory = this.botMemory.get(botMemoryKey);
    
    if (memory) {
      revealedCards.forEach(card => {
        if (!card.matched && Math.random() < 0.8) { // 80% memory retention
          memory.knownCards.set(card.index, card.value || card.symbol);
        }
      });
    }
  }

  // Clean up bot memory when game ends
  cleanupBotMemory(gameId) {
    // Remove all bot memories for this game
    const keysToDelete = [];
    for (const [key] of this.botMemory) {
      if (key.startsWith(`${gameId}_`)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => {
      this.botMemory.delete(key);
    });
    
    // Clean up decision history
    for (const [key] of this.botDecisionHistory) {
      if (key.includes(gameId)) {
        this.botDecisionHistory.delete(key);
      }
    }
    
    if (keysToDelete.length > 0) {
      logger.debug(`Cleaned up bot memory for game ${gameId} - ${keysToDelete.length} bots`);
    }
  }

  // Get bot statistics for monitoring
  getBotGameplayStatistics() {
    return {
      activeMemories: this.botMemory.size,
      decisionHistories: this.botDecisionHistory.size,
      memoryUsage: {
        botMemory: this.botMemory.size,
        decisionHistory: this.botDecisionHistory.size
      }
    };
  }
}

module.exports = new BotGameplayService();