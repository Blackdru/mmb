const logger = require('../../config/logger');
const prisma = require('../../config/database');

class BotGameplayService {
  constructor() {
    this.botMemory = new Map(); // Store bot memory for each game
  }

  // Check if current player is a bot and handle bot turn
  async checkAndHandleBotTurn(gameState, playerId, selectCardCallback) {
    try {
      const user = await prisma.user.findUnique({ where: { id: playerId } });
      if (user && user.isBot) {
        logger.info(`🤖 Bot turn detected for ${user.name} in game ${gameState.id}`);
        // Handle bot turn with a slight delay to make it feel natural
        setTimeout(() => {
          this.handleBotTurn(gameState, playerId, selectCardCallback);
        }, 1500); // 1.5 second delay
      }
    } catch (error) {
      logger.error(`Error checking bot turn for player ${playerId}:`, error);
    }
  }

  // Simple bot logic for making moves in Memory game
  async handleBotTurn(gameState, botPlayerId, selectCardCallback) {
    try {
      if (!gameState || gameState.status !== 'playing' || gameState.currentTurnPlayerId !== botPlayerId) {
        return;
      }

      // Get bot memory for this game
      const botMemoryKey = `${gameState.id}_${botPlayerId}`;
      const memory = this.botMemory.get(botMemoryKey) || { knownCards: new Map(), matchedPairs: new Set() };

      // Simple bot strategy: pick random available cards
      const board = JSON.parse(gameState.board);
      const availableIndices = [];
      
      board.forEach((card, index) => {
        if (!card.matched && !gameState.selectedCards.some(sel => sel.index === index)) {
          availableIndices.push(index);
        }
      });
      
      if (availableIndices.length === 0) return;
      
      // Select first card randomly
      const firstIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
      logger.info(`🤖 Bot ${botPlayerId} selecting first card at index ${firstIndex}`);
      
      await selectCardCallback({
        gameId: gameState.id,
        playerId: botPlayerId,
        cardIndex: firstIndex
      });
      
      // Wait before selecting second card
      setTimeout(async () => {
        // Remove first selected card from available indices
        const remainingIndices = availableIndices.filter(idx => idx !== firstIndex);
        
        if (remainingIndices.length > 0) {
          const secondIndex = remainingIndices[Math.floor(Math.random() * remainingIndices.length)];
          logger.info(`🤖 Bot ${botPlayerId} selecting second card at index ${secondIndex}`);
          
          await selectCardCallback({
            gameId: gameState.id,
            playerId: botPlayerId,
            cardIndex: secondIndex
          });
        }
      }, 2000); // 2 second delay between card selections
      
    } catch (error) {
      logger.error(`Error in bot turn for ${botPlayerId} in game ${gameState.id}:`, error);
    }
  }

  // Update bot memory when cards are revealed
  updateBotMemory(gameId, botPlayerId, revealedCards) {
    const botMemoryKey = `${gameId}_${botPlayerId}`;
    const memory = this.botMemory.get(botMemoryKey) || { knownCards: new Map(), matchedPairs: new Set() };
    
    // Store revealed card positions and values
    revealedCards.forEach(card => {
      if (!card.matched) {
        memory.knownCards.set(card.index, card.value);
      }
    });
    
    this.botMemory.set(botMemoryKey, memory);
  }

  // Clean up bot memory when game ends
  cleanupBotMemory(gameId) {
    // Remove all bot memories for this game
    for (const [key] of this.botMemory) {
      if (key.startsWith(`${gameId}_`)) {
        this.botMemory.delete(key);
      }
    }
    logger.debug(`Cleaned up bot memory for game ${gameId}`);
  }

  // Smart bot strategies (for future use)
  async getSmartBotMove(gameState, botPlayerId, difficulty = 'easy') {
    const botMemoryKey = `${gameState.id}_${botPlayerId}`;
    const memory = this.botMemory.get(botMemoryKey) || { knownCards: new Map(), matchedPairs: new Set() };
    
    switch (difficulty) {
      case 'easy':
        // Random selection (current implementation)
        return null;
        
      case 'medium':
        // Sometimes remember card positions
        // 50% chance to use memory
        if (Math.random() < 0.5 && memory.knownCards.size > 0) {
          // Try to find a matching pair from memory
          for (const [index1, value1] of memory.knownCards) {
            for (const [index2, value2] of memory.knownCards) {
              if (index1 !== index2 && value1 === value2) {
                return { firstCard: index1, secondCard: index2 };
              }
            }
          }
        }
        return null;
        
      case 'hard':
        // Always use memory, perfect recall
        // Check if we know any matching pairs
        for (const [index1, value1] of memory.knownCards) {
          for (const [index2, value2] of memory.knownCards) {
            if (index1 !== index2 && value1 === value2) {
              return { firstCard: index1, secondCard: index2 };
            }
          }
        }
        return null;
        
      default:
        return null;
    }
  }
}

module.exports = new BotGameplayService();