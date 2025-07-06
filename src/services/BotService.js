// BotService.js - Intelligent Bot Player for Memory Game
const logger = require('../config/logger');
const prisma = require('../config/database');

class BotService {
  constructor() {
    this.bots = new Map(); // gameId -> botState
    this.botProfiles = [
      {
        id: 'bot_memory_master',
        name: 'Ganesh',
        skillLevel: 0.85, // 85% accuracy
        reactionTime: { min: 1500, max: 3500 }, // 1.5-3.5 seconds
        personality: 'aggressive' // plays quickly, remembers well
      },
      {
        id: 'bot_card_wizard',
        name: 'Naresh',
        skillLevel: 0.75, // 75% accuracy
        reactionTime: { min: 2000, max: 4000 }, // 2-4 seconds
        personality: 'balanced' // moderate speed and accuracy
      },
      {
        id: 'bot_mind_reader',
        name: 'Swamy Charan',
        skillLevel: 0.80, // 80% accuracy
        reactionTime: { min: 1800, max: 3200 }, // 1.8-3.2 seconds
        personality: 'strategic' // slower but more accurate
      },
      {
        id: 'bot_quick_thinker',
        name: 'Mahendra',
        skillLevel: 0.70, // 70% accuracy
        reactionTime: { min: 1200, max: 2800 }, // 1.2-2.8 seconds
        personality: 'fast' // plays quickly but less accurate
      },
      {
        id: 'bot_pattern_seeker',
        name: 'Praveesh',
        skillLevel: 0.78, // 78% accuracy
        reactionTime: { min: 2200, max: 3800 }, // 2.2-3.8 seconds
        personality: 'methodical' // systematic approach
      }
    ];
  }

  // Create a bot user in the database for matchmaking
  async createBotUser() {
    try {
      // Select a random bot profile
      const profile = this.botProfiles[Math.floor(Math.random() * this.botProfiles.length)];
      
      // Check if bot user already exists
      let botUser = await prisma.user.findFirst({
        where: { id: profile.id }
      });

      if (!botUser) {
        // Create bot user with wallet
        botUser = await prisma.user.create({
          data: {
            id: profile.id,
            name: profile.name,
            phoneNumber: `bot_${profile.id}`,
            isBot: true, // Add this field to identify bots
            createdAt: new Date(),
            updatedAt: new Date(),
            wallet: {
              create: {
                balance: 999999.99 // Bots have unlimited balance
              }
            }
          },
          include: {
            wallet: true
          }
        });
        logger.info(`Created bot user: ${profile.name} (${profile.id}) with wallet balance: ₹999999.99`);
      }

      return {
        user: botUser,
        profile: profile
      };
    } catch (error) {
      logger.error('Error creating bot user:', error);
      throw error;
    }
  }

  // Initialize bot for a game
  initializeBotForGame(gameId, botUserId, profile, gameBoard) {
    const botState = {
      gameId,
      userId: botUserId,
      profile,
      memory: new Map(), // position -> symbol
      knownPairs: new Map(), // symbol -> [position1, position2]
      revealedCards: new Set(), // positions that have been revealed
      gameBoard: gameBoard || [],
      isActive: true,
      moveHistory: [],
      lastMoveTime: Date.now(),
      turnCount: 0
    };

    this.bots.set(gameId, botState);
    logger.info(`Initialized bot ${profile.name} for game ${gameId}`);
    return botState;
  }

  // Update bot's memory when cards are revealed
  updateBotMemory(gameId, position, symbol) {
    const bot = this.bots.get(gameId);
    if (!bot) return;

    // Store the card in memory
    bot.memory.set(position, symbol);
    bot.revealedCards.add(position);

    // Check if we now know a pair
    const positions = Array.from(bot.memory.entries())
      .filter(([pos, sym]) => sym === symbol)
      .map(([pos, sym]) => pos);

    if (positions.length === 2) {
      bot.knownPairs.set(symbol, positions);
      logger.debug(`Bot ${bot.profile.name} learned pair: ${symbol} at positions ${positions.join(', ')}`);
    }
  }

  // Get bot's next move
  async getBotMove(gameId, gameBoard) {
    const bot = this.bots.get(gameId);
    if (!bot || !bot.isActive) return null;

    bot.turnCount++;
    
    // Update game board
    bot.gameBoard = gameBoard;

    // Apply skill level - sometimes bot "forgets" or makes mistakes
    const shouldMakeMistake = Math.random() > bot.profile.skillLevel;
    
    let move = null;

    if (!shouldMakeMistake) {
      // Try to find a known pair first
      move = this.findKnownPair(bot);
      
      if (!move) {
        // Try to make an educated guess
        move = this.makeEducatedGuess(bot);
      }
    }

    if (!move) {
      // Random move as fallback
      move = this.makeRandomMove(bot);
    }

    if (move) {
      bot.moveHistory.push({
        positions: move,
        timestamp: Date.now(),
        strategy: move.strategy || 'random'
      });
      bot.lastMoveTime = Date.now();
    }

    return move;
  }

  // Find a known matching pair
  findKnownPair(bot) {
    for (const [symbol, positions] of bot.knownPairs.entries()) {
      const [pos1, pos2] = positions;
      
      // Check if both cards are still available (not matched)
      const card1 = bot.gameBoard[pos1];
      const card2 = bot.gameBoard[pos2];
      
      if (card1 && card2 && !card1.isMatched && !card2.isMatched && !card1.isFlipped && !card2.isFlipped) {
        logger.debug(`Bot ${bot.profile.name} found known pair: ${symbol} at ${pos1}, ${pos2}`);
        return {
          positions: [pos1, pos2],
          strategy: 'known_pair',
          confidence: 1.0
        };
      }
    }
    return null;
  }

  // Make an educated guess based on memory
  makeEducatedGuess(bot) {
    const availableCards = bot.gameBoard
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => !card.isMatched && !card.isFlipped);

    if (availableCards.length < 2) return null;

    // Look for cards we remember
    const rememberedCards = availableCards.filter(({ index }) => bot.memory.has(index));
    
    if (rememberedCards.length >= 2) {
      // Try to find a matching pair from remembered cards
      for (let i = 0; i < rememberedCards.length; i++) {
        const card1 = rememberedCards[i];
        const symbol1 = bot.memory.get(card1.index);
        
        for (let j = i + 1; j < rememberedCards.length; j++) {
          const card2 = rememberedCards[j];
          const symbol2 = bot.memory.get(card2.index);
          
          if (symbol1 === symbol2) {
            logger.debug(`Bot ${bot.profile.name} making educated guess: ${symbol1} at ${card1.index}, ${card2.index}`);
            return {
              positions: [card1.index, card2.index],
              strategy: 'educated_guess',
              confidence: 0.9
            };
          }
        }
      }
    }

    // If we have one remembered card, pair it with a random unknown card
    if (rememberedCards.length >= 1) {
      const unknownCards = availableCards.filter(({ index }) => !bot.memory.has(index));
      if (unknownCards.length >= 1) {
        const rememberedCard = rememberedCards[Math.floor(Math.random() * rememberedCards.length)];
        const unknownCard = unknownCards[Math.floor(Math.random() * unknownCards.length)];
        
        logger.debug(`Bot ${bot.profile.name} pairing remembered card ${rememberedCard.index} with unknown card ${unknownCard.index}`);
        return {
          positions: [rememberedCard.index, unknownCard.index],
          strategy: 'partial_guess',
          confidence: 0.3
        };
      }
    }

    return null;
  }

  // Make a random move
  makeRandomMove(bot) {
    const availableCards = bot.gameBoard
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => !card.isMatched && !card.isFlipped);

    if (availableCards.length < 2) return null;

    // Select two random cards
    const shuffled = availableCards.sort(() => Math.random() - 0.5);
    const pos1 = shuffled[0].index;
    const pos2 = shuffled[1].index;

    logger.debug(`Bot ${bot.profile.name} making random move: ${pos1}, ${pos2}`);
    return {
      positions: [pos1, pos2],
      strategy: 'random',
      confidence: 0.1
    };
  }

  // Calculate reaction time based on bot personality
  calculateReactionTime(gameId) {
    const bot = this.bots.get(gameId);
    if (!bot) return 2000; // Default 2 seconds

    const { min, max } = bot.profile.reactionTime;
    const baseTime = min + Math.random() * (max - min);
    
    // Adjust based on turn count (bots get slightly faster as game progresses)
    const speedupFactor = Math.max(0.7, 1 - (bot.turnCount * 0.05));
    
    return Math.floor(baseTime * speedupFactor);
  }

  // Handle bot turn in memory game
  async handleBotTurn(gameId, memoryGameService) {
    const bot = this.bots.get(gameId);
    if (!bot || !bot.isActive) return;

    try {
      // Get current game state
      const gameState = memoryGameService.games.get(gameId);
      if (!gameState || gameState.currentTurnPlayerId !== bot.userId) {
        return;
      }

      // Calculate reaction time
      const reactionTime = this.calculateReactionTime(gameId);
      
      logger.info(`Bot ${bot.profile.name} thinking for ${reactionTime}ms...`);

      // Wait for reaction time to simulate human thinking
      setTimeout(async () => {
        try {
          const move = await this.getBotMove(gameId, gameState.board);
          if (!move || !move.positions || move.positions.length !== 2) {
            logger.warn(`Bot ${bot.profile.name} could not generate valid move`);
            return;
          }

          const [pos1, pos2] = move.positions;
          
          // Make first move
          await this.makeBotMove(gameId, pos1, memoryGameService);
          
          // Wait a bit before second move (human-like behavior)
          const secondMoveDelay = 800 + Math.random() * 1200; // 0.8-2.0 seconds
          setTimeout(async () => {
            await this.makeBotMove(gameId, pos2, memoryGameService);
          }, secondMoveDelay);

        } catch (error) {
          logger.error(`Error in bot turn for ${bot.profile.name}:`, error);
        }
      }, reactionTime);

    } catch (error) {
      logger.error(`Error handling bot turn for game ${gameId}:`, error);
    }
  }

  // Make a single bot move
  async makeBotMove(gameId, position, memoryGameService) {
    const bot = this.bots.get(gameId);
    if (!bot || !bot.isActive) return;

    try {
      // Create a mock socket for the bot
      const mockSocket = {
        user: { id: bot.userId },
        emit: (event, data) => {
          // Bot doesn't need to receive events
          logger.debug(`Bot ${bot.profile.name} would receive: ${event}`, data);
        }
      };

      // Make the move through the memory game service
      await memoryGameService.selectCard(mockSocket, {
        gameId: gameId,
        roomId: gameId,
        playerId: bot.userId,
        position: position
      });

      logger.info(`Bot ${bot.profile.name} selected card at position ${position}`);

    } catch (error) {
      logger.error(`Error making bot move at position ${position}:`, error);
    }
  }

  // Clean up bot when game ends
  cleanupBot(gameId) {
    const bot = this.bots.get(gameId);
    if (bot) {
      bot.isActive = false;
      this.bots.delete(gameId);
      logger.info(`Cleaned up bot ${bot.profile.name} for game ${gameId}`);
    }
  }

  // Get bot statistics for debugging
  getBotStats(gameId) {
    const bot = this.bots.get(gameId);
    if (!bot) return null;

    return {
      name: bot.profile.name,
      skillLevel: bot.profile.skillLevel,
      turnCount: bot.turnCount,
      memorySize: bot.memory.size,
      knownPairs: bot.knownPairs.size,
      moveHistory: bot.moveHistory.length,
      isActive: bot.isActive
    };
  }

  // Handle card revealed event for bot learning
  onCardRevealed(gameId, position, symbol) {
    this.updateBotMemory(gameId, position, symbol);
  }

  // Handle cards matched event
  onCardsMatched(gameId, positions, symbol) {
    const bot = this.bots.get(gameId);
    if (!bot) return;

    // Remove from known pairs since they're now matched
    bot.knownPairs.delete(symbol);
    
    // Remove from memory since cards are no longer available
    positions.forEach(pos => {
      bot.memory.delete(pos);
      bot.revealedCards.delete(pos);
    });

    logger.debug(`Bot ${bot.profile.name} updated memory after match: ${symbol}`);
  }

  // Handle cards mismatched event
  onCardsMismatched(gameId, positions) {
    const bot = this.bots.get(gameId);
    if (!bot) return;

    // Cards are flipped back, but bot remembers them based on skill level
    positions.forEach(pos => {
      const shouldRemember = Math.random() < bot.profile.skillLevel;
      if (!shouldRemember) {
        // Bot "forgets" this card
        const symbol = bot.memory.get(pos);
        bot.memory.delete(pos);
        bot.revealedCards.delete(pos);
        
        // Also remove from known pairs if this was part of one
        if (symbol && bot.knownPairs.has(symbol)) {
          const pairPositions = bot.knownPairs.get(symbol);
          if (pairPositions.includes(pos)) {
            bot.knownPairs.delete(symbol);
          }
        }
        
        logger.debug(`Bot ${bot.profile.name} forgot card at position ${pos}`);
      }
    });
  }
}

module.exports = new BotService();