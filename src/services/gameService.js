const prisma = require('../config/database');
const logger = require('../config/logger');
const walletService = require('./walletService');
const pushNotificationService = require('./pushNotificationService');

class GameService {
  constructor() {
    }

  /**
   * Fixed Memory Game Board - 15 pairs (30 cards)
   */
  initializeMemoryGameBoard() {
    const CARD_SYMBOLS = [
      '🎮', '🎯', '🎲', '🃏', '🎪', '🎨', '🎭', '💡',
      '⚽', '🏀', '🏈', '🏸', '🏎️', '🏓', '🎾'
    ];
    
    // Use exactly 15 unique symbols for 30 cards (15 pairs)
    const selectedSymbols = CARD_SYMBOLS.slice(0, 15);
    const cards = [...selectedSymbols, ...selectedSymbols]; // Create exactly 2 of each symbol
    
    // Shuffle the cards (Fisher-Yates)
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }

    // Create card objects
    const gameBoard = cards.map((symbol, index) => ({
      id: index,
      symbol,
      isFlipped: false,
      isMatched: false,
    }));
    
    logger.info(`Memory game board initialized with ${gameBoard.length} cards (${selectedSymbols.length} pairs).`);
    return gameBoard;
  }

  async getGameById(gameId) {
    // Validate gameId parameter
    if (!gameId || typeof gameId !== 'string' || gameId.trim() === '') {
      logger.warn(`Invalid gameId provided to getGameById: ${gameId}`);
      return null;
    }

    try {
      return await prisma.game.findUnique({
        where: { id: gameId },
        include: {
          participants: { 
            include: { user: true },
            orderBy: { position: 'asc' }
          }
        }
      });
    } catch (error) {
      logger.error(`Error fetching game ${gameId}:`, error);
      return null;
    }
  }

  async getActiveGames() {
    try {
      return await prisma.game.findMany({
        where: {
          status: {
            in: ['WAITING', 'PLAYING']
          }
        },
        include: {
          participants: { 
            include: { user: true },
            orderBy: { position: 'asc' }
          }
        }
      });
    } catch (error) {
      logger.error('Error fetching active games:', error);
      return [];
    }
  }

  async updateGameState(gameId, newGameData, newCurrentTurn, newGameStatus = 'PLAYING', winnerId = null) {
    return prisma.game.update({
      where: { id: gameId },
      data: {
        gameData: newGameData,
        currentTurn: newCurrentTurn,
        status: newGameStatus,
        winner: winnerId,
        finishedAt: newGameStatus === 'FINISHED' ? new Date() : undefined,
        updatedAt: new Date()
      }
    });
  }

  /**
   * Fixed Memory Game Card Selection with proper validation
   */
  applyMemoryCardSelection(currentBoardState, position, selectedCardsInTurn) {
    const card = currentBoardState[position];

    if (!card) {
      return { success: false, message: 'Invalid card position.' };
    }
    if (card.isFlipped || card.isMatched) {
      return { success: false, message: 'Card already flipped or matched.' };
    }
    if (selectedCardsInTurn.length >= 2) {
      return { success: false, message: 'Maximum 2 cards per turn.' };
    }

    // Mark card as flipped
    card.isFlipped = true;
    selectedCardsInTurn.push({ position, symbol: card.symbol });

    let action = 'OPEN_CARD';
    
    // If two cards are selected, check for match
    if (selectedCardsInTurn.length === 2) {
      const [card1, card2] = selectedCardsInTurn;
      if (card1.symbol === card2.symbol) {
        // Match found!
        currentBoardState[card1.position].isMatched = true;
        currentBoardState[card2.position].isMatched = true;
        action = 'CARDS_MATCHED';
      } else {
        // No match
        action = 'CARDS_NO_MATCH';
      }
    }

    return {
      success: true,
      updatedCard: card,
      action: action,
      selectedCardsInTurn
    };
  }

  async processGameWinnings(gameId) {
    try {
      const game = await this.getGameById(gameId);
      if (!game || game.status !== 'FINISHED' || !game.winner) {
        logger.warn(`Cannot process winnings for game ${gameId}: invalid game state`);
        return;
      }

      // Check if winnings have already been processed to prevent double crediting
      try {
        const existingTransaction = await prisma.transaction.findFirst({
          where: {
            userId: game.winner,
            type: 'GAME_WINNING',
            gameId: gameId
          }
        });

        if (existingTransaction) {
          logger.warn(`Winnings already processed for game ${gameId}, skipping duplicate processing`);
          return;
        }
      } catch (transactionCheckError) {
        logger.warn(`Could not check existing transactions for game ${gameId}, proceeding with caution:`, transactionCheckError);
        // Continue with processing but log the issue
      }

      // Prize pool is already 90% of entry fees, so winner gets the full prize pool
      const winnerAmount = game.prizePool;
      await walletService.creditWallet(game.winner, winnerAmount, 'GAME_WINNING', gameId);
      
      // Send push notification to winner
      try {
        await pushNotificationService.sendGameResult(game.winner, {
          gameId: gameId,
          won: true,
          winnings: winnerAmount
        });
      } catch (notificationError) {
        logger.warn(`Failed to send win notification for game ${gameId}:`, notificationError);
      }
      
      // Send push notification to losers
      try {
        const losers = game.participants.filter(p => p.userId !== game.winner);
        for (const loser of losers) {
          await pushNotificationService.sendGameResult(loser.userId, {
            gameId: gameId,
            won: false,
            winnings: 0
          });
        }
      } catch (notificationError) {
        logger.warn(`Failed to send loss notifications for game ${gameId}:`, notificationError);
      }
      
      logger.info(`Game ${gameId} winnings processed: ₹${winnerAmount.toFixed(2)} credited to user ${game.winner}`);
    } catch (error) {
      logger.error(`Error processing game winnings for game ${gameId}:`, error);
    }
  }

  /**
   * Update player score in game participation record
   */
  async updatePlayerScore(gameId, playerId, newScore) {
    try {
      await prisma.gameParticipation.updateMany({
        where: {
          gameId: gameId,
          userId: playerId
        },
        data: {
          score: newScore
        }
      });
      logger.info(`Updated score for player ${playerId} in game ${gameId}: ${newScore}`);
    } catch (error) {
      logger.error(`Error updating player score for game ${gameId}, player ${playerId}:`, error);
      throw error;
    }
  }
}

module.exports = new GameService();