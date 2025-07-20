// Natural Bot Logic - Human-like Memory System with 100% Win Rate
const logger = require('../config/logger');
const prisma = require('../config/database');

class NaturalBotLogic {
  constructor() {
    this.botMemories = new Map();
  }

  // Initialize bot memory system
  initializeBotMemory(gameId, botId, botConfig) {
    const memoryKey = `${gameId}_${botId}`;
    
    const memory = {
      // Comprehensive memory of all revealed cards throughout the game
      revealedCards: new Map(), // position -> symbol
      
      // Game tracking
      turnCount: 0,
      gamePhase: 'early',
      
      // Human-like behavior
      baseThinkingTime: botConfig.humanBehavior?.thinkingTimeMin || 1500,
      variationFactor: botConfig.humanBehavior?.naturalVariation || 0.3,
      
      // Mistake system (1-2 mistakes per entire game)
      mistakesAllowed: Math.random() < 0.7 ? 1 : 2, // 70% chance of 1 mistake, 30% chance of 2
      mistakesMade: 0,
      lastMistakeTurn: 0,
      
      // Configuration
      botConfig: botConfig,
      isWinningBot: botConfig.winProbability >= 1.0
    };
    
    this.botMemories.set(memoryKey, memory);
    logger.info(`🧠 Initialized natural bot memory for ${botId} - Mistakes allowed: ${memory.mistakesAllowed}`);
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

      // Update memory with all currently visible cards from the game
      this.updateMemoryFromGameState(memory, gameState);
      
      // Update game phase
      this.updateGamePhase(memory, gameState);
      
      // Execute the natural turn logic
      await this.executeNaturalTurn(gameId, botId, gameState, memory, selectCardCallback);
      
    } catch (error) {
      logger.error(`Error in natural bot turn:`, error);
    }
  }

  // Update memory with all currently visible cards (both bot and opponent reveals)
  updateMemoryFromGameState(memory, gameState) {
    let newCardsLearned = 0;
    
    gameState.board.forEach((card, index) => {
      // Store any card that has been revealed (flipped or matched) and not already in memory
      if ((card.isFlipped || card.isMatched) && !memory.revealedCards.has(index)) {
        memory.revealedCards.set(index, card.symbol);
        newCardsLearned++;
        logger.info(`🧠 Bot learned: Position ${index} = ${card.symbol}`);
      }
    });
    
    if (newCardsLearned > 0) {
      logger.info(`🧠 Bot memory now contains ${memory.revealedCards.size} known cards`);
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
    
    // Get the symbol of the flipped card
    const firstCardSymbol = gameState.board[firstCard.index].symbol;
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
        
        // Add both cards to memory for future use
        memory.revealedCards.set(firstCard.index, firstCardSymbol);
        memory.revealedCards.set(secondCard.index, gameState.board[secondCard.index].symbol);
        
        logger.info(`🧠 Added both cards to memory. Memory now has ${memory.revealedCards.size} cards`);
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
          return position;
        }
      }
    }
    return null;
  }

  // Determine if bot should use the match (or make a mistake)
  shouldUseMatch(memory) {
    // Always use matches in late game (no mistakes when close to winning)
    if (memory.gamePhase === 'late') {
      return true;
    }
    
    // Check if bot has already made enough mistakes for this game
    if (memory.mistakesMade >= memory.mistakesAllowed) {
      return true;
    }
    
    // Don't make mistakes too frequently (at least 3 turns apart)
    if (memory.turnCount - memory.lastMistakeTurn < 3) {
      return true;
    }
    
    // Occasionally make mistakes to appear human
    if (memory.gamePhase === 'early') {
      return Math.random() > 0.12; // 12% chance of mistake in early game
    } else {
      return Math.random() > 0.06; // 6% chance of mistake in middle game
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
      totalCardsKnown: memory.revealedCards.size,,
      turnCount: memory.turnCount,,
      gamePhase: memory.gamePhase,,
      mistakesMade: memory.mistakesMade,,
      mistakesAllowed: memory.mistakesAllowed
    };
  }
}

module.exports = new NaturalBotLogic();
