// Natural Bot Logic - Human-like Memory System with 100% Win Rate
const logger = require('../config/logger');
const prisma = require('../config/database');

class NaturalBotLogic {
  constructor() {
    this.botMemories = new Map();
  }

  // Initialize bot memory system with enhanced mistake distribution
  initializeBotMemory(gameId, botId, botConfig) {
    const memoryKey = `${gameId}_${botId}`;
    
    const memory = {
      // Comprehensive memory of all revealed cards throughout the game
      revealedCards: new Map(), // position -> symbol
      
      // Game tracking
      turnCount: 0,
      gamePhase: 'early',
      totalGameTurns: 0, // Track total turns in game for mistake distribution
      
      // Human-like behavior
      baseThinkingTime: botConfig.humanBehavior?.thinkingTimeMin || 1500,
      variationFactor: botConfig.humanBehavior?.naturalVariation || 0.3,
      
      // Enhanced mistake system with strategic distribution
      mistakesAllowed: 5, // Increased from 3 to 5 for more human behavior
      mistakesMade: 0,
      lastMistakeTurn: 0,
      
      // Strategic mistake distribution plan
      mistakeDistribution: {
        early: 2,    // 2 mistakes in early game (first 30% of game)
        middle: 2,   // 2 mistakes in middle game (30-70% of game)
        late: 1      // 1 mistake in late game (70%+ of game)
      },
      mistakesByPhase: {
        early: 0,
        middle: 0,
        late: 0
      },
      
      // Opponent mistake tracking
      opponentMistakes: 0,
      opponentTurns: 0,
      lastOpponentMistakeTurn: 0,
      
      // Configuration
      botConfig: botConfig,
      isWinningBot: botConfig.winProbability >= 1.0
    };
    
    this.botMemories.set(memoryKey, memory);
    logger.info(`🧠 Initialized enhanced bot memory for ${botId} - Mistakes allowed: ${memory.mistakesAllowed} (Early: ${memory.mistakeDistribution.early}, Middle: ${memory.mistakeDistribution.middle}, Late: ${memory.mistakeDistribution.late})`);
    return memory;
  }

  // Main bot turn execution
  async executeBotTurn(gameId, botId, gameState, selectCardCallback) {
    try {
      const memoryKey = `${gameId}_${botId}`;
      let memory = this.botMemories.get(memoryKey);
      
      if (!memory) {
        const user = await prisma.user.findUnique({ where: { id: botId } });
        const botConfig = user?.botType ? 
          require('./BotService').getBotTypeConfig(user.botType) : 
          require('./BotService').getBotTypeConfig('strategic_master');
        memory = this.initializeBotMemory(gameId, botId, botConfig);
      }

      // CRITICAL: Update memory with ALL currently visible cards from the game
      this.updateMemoryFromGameState(memory, gameState);
      
      // Update game phase
      this.updateGamePhase(memory, gameState);
      
      // Execute the natural turn logic
      await this.executeNaturalTurn(gameId, botId, gameState, memory, selectCardCallback);
      
    } catch (error) {
      logger.error(`Error in natural bot turn:`, error);
    }
  }

  // ENHANCED: Update memory with all currently visible cards (both bot and opponent reveals)
  updateMemoryFromGameState(memory, gameState) {
    let newCardsLearned = 0;
    
    gameState.board.forEach((card, index) => {
      // Store any card that has been revealed (flipped or matched) and not already in memory
      if ((card.isFlipped || card.isMatched) && !memory.revealedCards.has(index)) {
        memory.revealedCards.set(index, card.symbol);
        newCardsLearned++;
        logger.info(`🧠 Bot learned: Position ${index} = ${card.symbol} (${card.isFlipped ? 'flipped' : 'matched'})`);
      }
    });
    
    if (newCardsLearned > 0) {
      logger.info(`🧠 Bot memory now contains ${memory.revealedCards.size} known cards`);
      this.logMemoryContents(memory);
    }
  }

  // NEW: Update bot memory when cards are revealed by other players
  updateBotMemoryWithRevealedCards(gameId, botId, revealedCards, wasSuccessful) {
    const memoryKey = `${gameId}_${botId}`;
    let memory = this.botMemories.get(memoryKey);
    
    if (!memory) {
      logger.warn(`No memory found for bot ${botId} in game ${gameId} - creating new memory`);
      // Create memory if it doesn't exist
      const botConfig = require('./BotService').getBotTypeConfig('strategic_master');
      memory = this.initializeBotMemory(gameId, botId, botConfig);
    }

    // Add revealed cards to memory
    revealedCards.forEach(cardInfo => {
      if (cardInfo.position !== undefined && cardInfo.symbol) {
        if (!memory.revealedCards.has(cardInfo.position)) {
          memory.revealedCards.set(cardInfo.position, cardInfo.symbol);
          logger.info(`🧠 Bot ${botId} learned from other player: Position ${cardInfo.position} = ${cardInfo.symbol}`);
        }
      }
    });

    // If cards were matched, remove them from memory (they're no longer on the board)
    if (wasSuccessful && revealedCards.length === 2) {
      revealedCards.forEach(cardInfo => {
        memory.revealedCards.delete(cardInfo.position);
      });
      logger.info(`🧠 Bot ${botId} removed matched cards from memory`);
    } else if (!wasSuccessful && revealedCards.length === 2) {
      // Track opponent mistake when they fail to match
      const opponentId = this.getOpponentIdFromReveal(gameId, botId, revealedCards);
      if (opponentId) {
        this.trackOpponentMistake(gameId, opponentId);
      }
    }

    logger.info(`🧠 Bot ${botId} memory now contains ${memory.revealedCards.size} known cards`);
    this.logMemoryContents(memory);
  }

  // Helper method to identify opponent from card reveal
  getOpponentIdFromReveal(gameId, botId, revealedCards) {
    // This would need to be implemented based on game state tracking
    // For now, we'll track mistakes when processMatch is called
    return null;
  }

  // NEW: Log memory contents for debugging
  logMemoryContents(memory) {
    if (memory.revealedCards.size > 0) {
      const memoryList = [];
      for (const [position, symbol] of memory.revealedCards) {
        memoryList.push(`${position}:${symbol}`);
      }
      logger.info(`🧠 Memory contents: [${memoryList.join(', ')}]`);
      
      // Log potential matches
      const potentialMatches = [];
      const symbolCounts = new Map();
      for (const [position, symbol] of memory.revealedCards) {
        if (!symbolCounts.has(symbol)) {
          symbolCounts.set(symbol, []);
        }
        symbolCounts.get(symbol).push(position);
      }
      
      for (const [symbol, positions] of symbolCounts) {
        if (positions.length >= 2) {
          potentialMatches.push(`${symbol}:[${positions.join(',')}]`);
        }
      }
      
      if (potentialMatches.length > 0) {
        logger.info(`🎯 Potential matches in memory: ${potentialMatches.join(', ')}`);
      }
    }
  }

  // Update game phase based on progress
  updateGamePhase(memory, gameState) {
    const totalCards = gameState.board.length;
    const matchedCards = gameState.board.filter(card => card.isMatched).length;
    const progress = matchedCards / totalCards;
    
    if (progress < 0.3) {
      memory.gamePhase = 'early';
    } else if (progress < 0.7) {
      memory.gamePhase = 'middle';
    } else {
      memory.gamePhase = 'late';
    }
  }

  // Execute natural human-like turn
  async executeNaturalTurn(gameId, botId, gameState, memory, selectCardCallback) {
    memory.turnCount++;
    
    // Human-like thinking delay
    const thinkingTime = this.calculateThinkingTime(memory);
    await this.delay(thinkingTime);

    // Find available cards (not flipped, not matched)
    const availableCards = gameState.board
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => !card.isFlipped && !card.isMatched);

    if (availableCards.length === 0) return;

    // STEP 1: Always flip first card randomly (human exploration behavior)
    const firstCard = this.selectRandomCard(availableCards);
    
    logger.info(`🤖 Bot randomly flipping first card at position ${firstCard.index}`);
    await selectCardCallback(gameId, botId, firstCard.index);
    
    // CRITICAL FIX: Bot must wait for the card to be revealed through the game system
    // Bot cannot access unrevealed card symbols directly from gameState.board
    // The symbol will be learned when the card is actually flipped and revealed
    
    // Wait for the card flip to be processed by the game system
    await this.delay(500); // Give time for the card to be revealed
    
    // Get the revealed symbol from memory (it should have been updated by updateMemoryFromGameState)
    let firstCardSymbol = memory.revealedCards.get(firstCard.index);
    
    // If symbol is not in memory yet, it means the card wasn't properly revealed
    if (!firstCardSymbol) {
      logger.warn(`🤖 Bot cannot see first card symbol yet at position ${firstCard.index}, will flip random second card`);
      // Flip a random second card since we can't see the first card's symbol
      const remainingCards = availableCards.filter(c => c.index !== firstCard.index);
      if (remainingCards.length > 0) {
        const secondCard = this.selectRandomCard(remainingCards);
        logger.info(`🤖 Bot flipping second random card at position ${secondCard.index} (first card not visible)`);
        await selectCardCallback(gameId, botId, secondCard.index);
      }
      return;
    }
    
    logger.info(`🧠 First card revealed: ${firstCardSymbol}`);

    // Delay before checking memory and making decision
    const decisionDelay = this.calculateDecisionDelay(memory);
    await this.delay(decisionDelay);

    // STEP 2: Check memory for matching card
    const matchingPosition = this.findMatchInMemory(memory, firstCardSymbol, firstCard.index, availableCards);
    
    if (matchingPosition !== null && this.shouldUseMatch(memory)) {
      // FOUND MATCH IN MEMORY - Select the matching card
      logger.info(`🎯 Bot found match in memory: ${firstCardSymbol} at position ${matchingPosition}`);
      await selectCardCallback(gameId, botId, matchingPosition);
      
      // Remove both matched cards from memory (they're now matched and gone)
      memory.revealedCards.delete(firstCard.index);
      memory.revealedCards.delete(matchingPosition);
      
      logger.info(`🧠 Removed matched cards from memory. Memory now has ${memory.revealedCards.size} cards`);
      
    } else {
      // NO MATCH FOUND OR MAKING MISTAKE - Flip second random card
      const remainingCards = availableCards.filter(c => c.index !== firstCard.index);
      
      if (remainingCards.length > 0) {
        const secondCard = this.selectRandomCard(remainingCards);
        
        if (matchingPosition !== null) {
          // Bot had a match but chose to make a mistake
          logger.info(`🎭 Bot making intentional mistake (${memory.mistakesMade + 1}/${memory.mistakesAllowed}) - ignoring known match`);
          memory.mistakesMade++;
          memory.lastMistakeTurn = memory.turnCount;
        }
        
        logger.info(`🤖 Bot flipping second random card at position ${secondCard.index}`);
        await selectCardCallback(gameId, botId, secondCard.index);
        
        // CRITICAL FIX: Bot can only learn the second card's symbol after it's revealed
        // The symbol will be added to memory by the game system when the card is flipped
        // We don't add it here since the bot shouldn't know unrevealed symbols
        
        logger.info(`🧠 Bot will learn second card symbol when it's revealed by the game system`);
      }
    }
  }

  // Find matching card in bot's memory
  findMatchInMemory(memory, targetSymbol, excludePosition, availableCards) {
    // Look through memory for a card with the same symbol
    for (const [position, symbol] of memory.revealedCards) {
      if (position !== excludePosition && symbol === targetSymbol) {
        // Check if this position is still available to select
        const isAvailable = availableCards.some(c => c.index === position);
        if (isAvailable) {
          logger.info(`🎯 Found matching card in memory: ${symbol} at position ${position}`);
          return position;
        }
      }
    }
    return null;
  }

  // Enhanced strategic mistake distribution system
  shouldUseMatch(memory) {
    // Update mistake tracking by phase
    this.updateMistakesByPhase(memory);
    
    // Check if bot has already made enough mistakes for this game
    if (memory.mistakesMade >= memory.mistakesAllowed) {
      logger.info(`🎯 Bot has made maximum mistakes (${memory.mistakesMade}/${memory.mistakesAllowed}) - using all matches`);
      return true;
    }
    
    // Don't make mistakes too frequently (at least 2 turns apart for better distribution)
    if (memory.turnCount - memory.lastMistakeTurn < 2) {
      logger.info(`🎯 Too soon since last mistake (turn ${memory.lastMistakeTurn}) - using match`);
      return true;
    }
    
    // Strategic mistake distribution based on game phase
    const currentPhase = memory.gamePhase;
    const mistakesInCurrentPhase = memory.mistakesByPhase[currentPhase];
    const allowedMistakesInPhase = memory.mistakeDistribution[currentPhase];
    
    // If we've already made enough mistakes in this phase, use the match
    if (mistakesInCurrentPhase >= allowedMistakesInPhase) {
      logger.info(`🎯 Phase ${currentPhase}: Already made ${mistakesInCurrentPhase}/${allowedMistakesInPhase} mistakes - using match`);
      return true;
    }
    
    // Special handling for late game - be more careful about mistakes
    if (memory.gamePhase === 'late') {
      // Only make mistakes if we haven't made our late game mistake yet
      if (mistakesInCurrentPhase === 0) {
        // 15% chance of making the final mistake in late game
        const shouldMakeMistake = Math.random() < 0.15;
        if (shouldMakeMistake) {
          logger.info(`🎭 Late game: Making strategic final mistake (${mistakesInCurrentPhase + 1}/${allowedMistakesInPhase})`);
          memory.mistakesByPhase[currentPhase]++;
          return false;
        }
      }
      return true; // Use match in late game if we've already made our mistake
    }
    
    // Calculate mistake probability based on phase and remaining mistakes
    let mistakeProbability = 0;
    
    if (currentPhase === 'early') {
      // Early game: Higher chance of mistakes (25% base chance)
      mistakeProbability = 0.25;
      
      // Increase probability if we haven't made enough mistakes yet
      if (mistakesInCurrentPhase < allowedMistakesInPhase) {
        mistakeProbability += 0.1; // Boost to 35%
      }
    } else if (currentPhase === 'middle') {
      // Middle game: Moderate chance of mistakes (20% base chance)
      mistakeProbability = 0.20;
      
      // Increase probability if we haven't made enough mistakes yet
      if (mistakesInCurrentPhase < allowedMistakesInPhase) {
        mistakeProbability += 0.1; // Boost to 30%
      }
    }
    
    // Make the decision
    const shouldMakeMistake = Math.random() < mistakeProbability;
    
    if (shouldMakeMistake) {
      logger.info(`🎭 ${currentPhase} game: Making strategic mistake (${mistakesInCurrentPhase + 1}/${allowedMistakesInPhase}) - probability: ${(mistakeProbability * 100).toFixed(1)}%`);
      memory.mistakesByPhase[currentPhase]++;
      return false; // Don't use the match (make mistake)
    }
    
    logger.info(`🎯 ${currentPhase} game: Using match - probability check passed (${(mistakeProbability * 100).toFixed(1)}% chance of mistake)`);
    return true; // Use the match
  }
  
  // Helper method to update mistakes by phase tracking
  updateMistakesByPhase(memory) {
    // This method ensures we're tracking mistakes correctly by phase
    // The actual mistake counting is done in shouldUseMatch when a mistake is made
    const currentPhase = memory.gamePhase;
    
    // Log current mistake distribution for debugging
    if (memory.turnCount % 5 === 0) { // Log every 5 turns to avoid spam
      logger.info(`🎭 Mistake distribution - Early: ${memory.mistakesByPhase.early}/${memory.mistakeDistribution.early}, Middle: ${memory.mistakesByPhase.middle}/${memory.mistakeDistribution.middle}, Late: ${memory.mistakesByPhase.late}/${memory.mistakeDistribution.late} (Current phase: ${currentPhase})`);
    }
  }

  // Select random card (human-like exploration)
  selectRandomCard(availableCards) {
    return availableCards[Math.floor(Math.random() * availableCards.length)];
  }

  // Calculate human-like thinking time for first card
  calculateThinkingTime(memory) {
    const baseTime = memory.baseThinkingTime;
    const variation = memory.variationFactor;
    
    let multiplier = 1.0;
    
    // Early game - more exploration time
    if (memory.gamePhase === 'early') {
      multiplier += 0.2;
    }
    
    // Add natural variation
    const variationAmount = (Math.random() - 0.5) * 2 * variation * baseTime;
    
    return Math.max(800, baseTime * multiplier + variationAmount);
  }

  // Calculate decision delay (time to check memory and decide)
  calculateDecisionDelay(memory) {
    const baseDelay = 600; // Base time to "think" about the revealed card
    const variation = (Math.random() - 0.5) * 0.4 * baseDelay;
    
    return Math.max(400, baseDelay + variation);
  }

  // Utility delay function
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Clean up memory when game ends
  cleanupGameMemory(gameId) {
    const keysToDelete = [];
    for (const [key] of this.botMemories) {
      if (key.startsWith(`${gameId}_`)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => {
      this.botMemories.delete(key);
    });
    
    logger.info(`Cleaned up natural bot memories for game ${gameId}`);
  }

  // Get memory stats for debugging
  getMemoryStats(gameId, botId) {
    const memoryKey = `${gameId}_${botId}`;
    const memory = this.botMemories.get(memoryKey);
    
    if (!memory) return null;
    
    return {
      totalCardsKnown: memory.revealedCards.size,
      turnCount: memory.turnCount,
      gamePhase: memory.gamePhase,
      mistakesMade: memory.mistakesMade,
      mistakesAllowed: memory.mistakesAllowed,
      opponentMistakes: memory.opponentMistakes,
      opponentTurns: memory.opponentTurns
    };
  }

  // NEW: Track opponent mistake when they fail to match cards
  trackOpponentMistake(gameId, opponentId) {
    try {
      // Find all bot memories for this game and update opponent mistake count
      for (const [memoryKey, memory] of this.botMemories.entries()) {
        if (memoryKey.startsWith(`${gameId}_`) && !memoryKey.endsWith(`_${opponentId}`)) {
          memory.opponentMistakes++;
          memory.opponentTurns++;
          memory.lastOpponentMistakeTurn = memory.opponentTurns;
          
          // Adjust bot mistake allowance based on opponent performance
          this.adjustBotMistakeAllowance(memory);
          
          logger.info(`🎭 Opponent mistake tracked: ${memory.opponentMistakes} mistakes in ${memory.opponentTurns} turns. Bot mistakes allowed: ${memory.mistakesAllowed}`);
        }
      }
    } catch (error) {
      logger.error('Error tracking opponent mistake:', error);
    }
  }

  // NEW: Track opponent successful turn (no mistake)
  trackOpponentSuccess(gameId, opponentId) {
    try {
      // Find all bot memories for this game and update opponent turn count
      for (const [memoryKey, memory] of this.botMemories.entries()) {
        if (memoryKey.startsWith(`${gameId}_`) && !memoryKey.endsWith(`_${opponentId}`)) {
          memory.opponentTurns++;
          
          // Adjust bot mistake allowance based on opponent performance
          this.adjustBotMistakeAllowance(memory);
          
          logger.info(`🎯 Opponent success tracked: ${memory.opponentMistakes} mistakes in ${memory.opponentTurns} turns. Bot mistakes allowed: ${memory.mistakesAllowed}`);
        }
      }
    } catch (error) {
      logger.error('Error tracking opponent success:', error);
    }
  }

  // Enhanced bot mistake allowance adjustment based on opponent performance
  adjustBotMistakeAllowance(memory) {
    const oldMistakesAllowed = memory.mistakesAllowed;
    
    // Enhanced mistake scaling based on opponent performance
    if (memory.opponentMistakes >= 5) {
      // If opponent makes 5+ mistakes, increase bot mistakes to 7 for maximum human behavior
      memory.mistakesAllowed = Math.max(memory.mistakesAllowed, 7);
      
      // Update mistake distribution for 7 mistakes: 3-3-1 pattern
      if (memory.mistakesAllowed === 7) {
        memory.mistakeDistribution = {
          early: 3,    // 3 mistakes in early game
          middle: 3,   // 3 mistakes in middle game  
          late: 1      // 1 mistake in late game
        };
      }
      
      logger.info(`🎭 Opponent made ${memory.opponentMistakes} mistakes - increasing bot mistakes to ${memory.mistakesAllowed} with distribution (${memory.mistakeDistribution.early}-${memory.mistakeDistribution.middle}-${memory.mistakeDistribution.late})`);
    }
    // If opponent has made 3-4 mistakes, increase bot mistakes to 6
    else if (memory.opponentMistakes >= 3) {
      memory.mistakesAllowed = Math.max(memory.mistakesAllowed, 6);
      
      // Update mistake distribution for 6 mistakes: 2-3-1 pattern
      if (memory.mistakesAllowed === 6) {
        memory.mistakeDistribution = {
          early: 2,    // 2 mistakes in early game
          middle: 3,   // 3 mistakes in middle game
          late: 1      // 1 mistake in late game
        };
      }
      
      logger.info(`🎭 Opponent made ${memory.opponentMistakes} mistakes - increasing bot mistakes to ${memory.mistakesAllowed} with distribution (${memory.mistakeDistribution.early}-${memory.mistakeDistribution.middle}-${memory.mistakeDistribution.late})`);
    }
    // Default is 5 mistakes with 2-2-1 distribution (already set in initialization)
    
    // Log the adjustment if it changed
    if (oldMistakesAllowed !== memory.mistakesAllowed) {
      logger.info(`🔄 Bot mistake allowance adjusted from ${oldMistakesAllowed} to ${memory.mistakesAllowed} based on opponent performance`);
    }
  }

  // NEW: Get opponent mistake statistics for a game
  getOpponentStats(gameId, botId) {
    const memoryKey = `${gameId}_${botId}`;
    const memory = this.botMemories.get(memoryKey);
    
    if (!memory) return null;
    
    return {
      opponentMistakes: memory.opponentMistakes,
      opponentTurns: memory.opponentTurns,
      opponentMistakeRate: memory.opponentTurns > 0 ? (memory.opponentMistakes / memory.opponentTurns) : 0,
      botMistakesAllowed: memory.mistakesAllowed,
      botMistakesMade: memory.mistakesMade
    };
  }
}

module.exports = new NaturalBotLogic();