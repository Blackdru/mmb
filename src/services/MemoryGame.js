// MemoryGameService.js - Complete Memory Game Implementation
const logger = require('../config/logger');
const gameService = require('./gameService');
const prisma = require('../config/database');
const botService = require('./botService');
const GameplayController = require('../bot-system/services/GameplayController');
const PerformanceBalancer = require('../bot-system/services/PerformanceBalancer');

class MemoryGameService {
  constructor(io) {
    this.io = io;
    this.games = new Map();
    this.TURN_TIMER = 15000; // 15 seconds total for 2 cards
    this.turnTimers = new Map();
    this.countdownIntervals = new Map();
    this.processedWinnings = new Set(); // Track games where winnings have been processed
    
    // Global error handler for this service
    this.handleError = this.handleError.bind(this);
  }

  // Global error handler
  handleError(error, context = 'Unknown') {
    logger.error(`MemoryGame Service Error in ${context}:`, error);
    // Don't re-throw to prevent unhandled rejections
  }

  setupSocketHandlers(socket) {
    socket.on('START_MEMORY_GAME', (data) => {
      this.startGame(data).catch(err => {
        logger.error('Error in START_MEMORY_GAME handler:', err);
        socket.emit('MEMORY_GAME_ERROR', { message: 'Failed to start game' });
      });
    });
    
    socket.on('SELECT_MEMORY_CARD', (data) => {
      this.selectCard(socket, data).catch(err => {
        logger.error('Error in SELECT_MEMORY_CARD handler:', err);
        socket.emit('MEMORY_GAME_ERROR', { message: 'Failed to select card' });
      });
    });
    
    socket.on('selectCard', (data) => {
      this.selectCard(socket, data).catch(err => {
        logger.error('Error in selectCard handler:', err);
        socket.emit('MEMORY_GAME_ERROR', { message: 'Failed to select card' });
      });
    });
    
    socket.on('JOIN_MEMORY_ROOM', (data) => {
      this.joinRoom(socket, data).catch(err => {
        logger.error('Error in JOIN_MEMORY_ROOM handler:', err);
        socket.emit('MEMORY_GAME_ERROR', { message: 'Failed to join room' });
      });
    });
    
    socket.on('LEAVE_MEMORY_GAME', (data) => {
      this.handlePlayerLeave(socket, data).catch(err => {
        logger.error('Error in LEAVE_MEMORY_GAME handler:', err);
      });
    });
    
    socket.on('disconnect', () => {
      this.handlePlayerDisconnect(socket).catch(err => {
        logger.error('Error in disconnect handler:', err);
      });
    });
  }

  async safeProcessWinnings(gameId, winnerId, reason = 'game_completed') {
    // Check if winnings have already been processed for this game
    if (this.processedWinnings.has(gameId)) {
      logger.warn(`Winnings already processed for game ${gameId}, skipping duplicate processing`);
      return { success: false, reason: 'already_processed' };
    }

    // Mark as processed immediately to prevent race conditions
    this.processedWinnings.add(gameId);

    try {
      const game = await gameService.getGameById(gameId);
      if (!game) {
        logger.error(`Game ${gameId} not found for winnings processing`);
        this.processedWinnings.delete(gameId);
        return { success: false, reason: 'game_not_found' };
      }

      // Check if game already has winnings processed in database
      const existingWinningTransaction = await prisma.transaction.findFirst({
        where: {
          gameId: gameId,
          type: 'GAME_WINNING',
          status: 'COMPLETED'
        }
      });

      if (existingWinningTransaction) {
        logger.warn(`Game ${gameId} already has winning transaction ${existingWinningTransaction.id}, skipping duplicate processing`);
        return { success: false, reason: 'already_processed_in_db' };
      }

      const walletService = require('./walletService');

      // Handle different end game scenarios
      if (reason === 'network_issue' || reason === 'server_error') {
        // Refund all players for network/server issues
        logger.info(`Refunding all players for game ${gameId} due to ${reason}`);
        for (const participant of game.participants) {
          await walletService.creditWallet(
            participant.userId, 
            game.entryFee, 
            'REFUND', 
            gameId,
            `Game refund due to ${reason}`
          );
        }
        return { success: true, reason: 'refunded_all_players' };
      } else if (winnerId && (reason === 'game_completed' || reason === 'opponent_quit' || reason === 'opponent_eliminated')) {
        // Only credit winner for legitimate scenarios
        logger.info(`Processing winnings for ${reason}: ${gameId}, winner: ${winnerId}`);
        
        // Use direct wallet credit instead of gameService to avoid double processing
        await walletService.creditWallet(
          winnerId, 
          game.prizePool, 
          'GAME_WINNING', 
          gameId,
          `Game winning for ${reason}`
        );
        
        logger.info(`Successfully credited ₹${game.prizePool} to winner ${winnerId} for game ${gameId}`);
        return { success: true, reason: 'winner_credited', amount: game.prizePool };
      } else {
        logger.warn(`No valid winner or reason for game ${gameId}, no winnings processed. Winner: ${winnerId}, Reason: ${reason}`);
        this.processedWinnings.delete(gameId); // Remove from processed since nothing was done
        return { success: false, reason: 'invalid_winner_or_reason' };
      }
    } catch (error) {
      logger.error(`Failed to process game winnings for game ${gameId}:`, error);
      // Remove from processed set if it failed, so it can be retried
      this.processedWinnings.delete(gameId);
      return { success: false, reason: 'processing_error', error: error.message };
    }
  }

  async startGame({ roomId }) {
    try {
      logger.info(`Memory Game: Starting game ${roomId}`);
      
      const game = await gameService.getGameById(roomId);
      if (!game || !game.participants || game.participants.length < 2) {
        this.io.to(`game:${roomId}`).emit('MEMORY_GAME_ERROR', { 
          message: 'Not enough players to start game.' 
        });
        return;
      }

      // Initialize game board with 15 pairs (30 cards)
      const { cards: initialBoard } = this.createGameBoard(roomId);
      
      // Create players array
      const players = game.participants.map((p, index) => ({
        id: p.userId,
        name: p.user?.name || `Player ${index + 1}`,
        position: index,
        score: 0
      }));

      // Initialize game state
      const gameState = {
        board: initialBoard,
        players: players,
        currentTurnIndex: 0,
        currentTurnPlayerId: players[0].id,
        selectedCards: [],
        scores: {},
        lifelines: {},
        missedTurns: {},
        matchedPairs: 0,
        totalPairs: 15,
        status: 'playing',
        processingCards: false
      };

      // Initialize scores and lifelines
      players.forEach(player => {
        gameState.scores[player.id] = 0;
        gameState.lifelines[player.id] = 3; // Each player starts with 3 lifelines
        gameState.missedTurns[player.id] = 0;
      });

      // Store game instance
      this.games.set(roomId, gameState);

      // Initialize bots for any bot players
      for (const player of players) {
        const user = await prisma.user.findUnique({ where: { id: player.id } });
        if (user && user.isBot) {
          logger.info(`🤖 Bot player ${user.name} (${user.id}) detected in game ${roomId}`);
          // Bot initialization will be handled when it's their turn
        }
      }

      // Update database
      await gameService.updateGameState(roomId, initialBoard, 0, 'PLAYING', null);

      console.log(`Memory Game: Starting game ${roomId} with prize pool: ${game.prizePool}`);
      
      // Emit game started with delay to ensure all clients are ready
      setTimeout(() => {
        this.io.to(`game:${roomId}`).emit('MEMORY_GAME_STARTED', {
          players: players,
          totalPairs: 15,
          prizePool: game.prizePool || 0,
          currentTurn: players[0].id,
          currentPlayerId: players[0].id,
          currentPlayerName: players[0].name,
          gameBoard: initialBoard
        });

        // Emit initial turn state with delay
        setTimeout(() => {
          this.io.to(`game:${roomId}`).emit('MEMORY_GAME_CURRENT_TURN', {
            currentPlayer: players[0].id,
            currentPlayerId: players[0].id,
            currentPlayerName: players[0].name,
            players: players
          });

          // Start turn timer after ensuring all data is sent
          setTimeout(() => {
            this.startTurnTimer(roomId);
            
            // If first player is a bot, handle bot turn
            if (players[0]) {
              logger.info(`🎮 Checking if first player ${players[0].name} (${players[0].id}) is a bot for game ${roomId}`);
              this.checkAndHandleBotTurn(roomId, players[0].id).catch(err => {
                logger.error('Error checking bot turn in startGame:', err);
              });
            }
          }, 500);
        }, 300);
      }, 200);

      logger.info(`Memory Game: Game ${roomId} started successfully with ${players.length} players`);
    } catch (error) {
      logger.error(`Memory Game: Error starting game ${roomId}:`, error);
      this.io.to(`game:${roomId}`).emit('MEMORY_GAME_ERROR', { 
        message: 'Failed to start game.' 
      });
    }
  }

  createGameBoard(roomId) {
    const symbols = ['🎮', '🎯', '🎲', '🃏', '🎪', '🎨', '🎭', '💡', '🏸','🏎️', '🏀', '⚽', '🏈', '🏓', '🎾'];
    const cards = [];
    
    // Create pairs - use all 15 symbols for 30 cards (15 pairs)
    symbols.forEach((symbol, index) => {
      cards.push({
        id: index * 2,
        position: index * 2,
        symbol: symbol,
        isFlipped: false,
        isMatched: false
      });
      cards.push({
        id: index * 2 + 1,
        position: index * 2 + 1,
        symbol: symbol,
        isFlipped: false,
        isMatched: false
      });
    });

    console.log(`Memory Game: Created ${cards.length} cards before shuffle`);

    // Use deterministic seed based on room ID for consistent shuffling
    const seed = roomId ? roomId.split('').reduce((a, b) => a + b.charCodeAt(0), 0) : Date.now();
    
    // Seeded random function with better distribution
    let seedValue = seed;
    const seededRandom = () => {
      seedValue = (seedValue * 16807) % 2147483647;
      return seedValue / 2147483647;
    };

    // Multiple pass Fisher-Yates shuffle for better randomization
    for (let pass = 0; pass < 3; pass++) {
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
    }

    // Update positions after shuffle
    cards.forEach((card, index) => {
      card.position = index;
    });

    // Validation: Ensure each symbol appears exactly twice
    const symbolCount = {};
    cards.forEach(card => {
      symbolCount[card.symbol] = (symbolCount[card.symbol] || 0) + 1;
    });
    const invalidSymbols = Object.entries(symbolCount).filter(([sym, count]) => count !== 2);
    if (invalidSymbols.length > 0) {
      throw new Error('MemoryGame: Invalid card distribution! Each symbol must appear exactly twice. Distribution: ' + JSON.stringify(symbolCount));
    }

    console.log(`Memory Game: Shuffled cards, first few symbols:`, cards.slice(0, 6).map(c => c.symbol));

    return { cards };
  }

  
  async selectCard(socket, data) {
    try {
      const gameId = data.gameId || data.roomId;
      const playerId = data.playerId || socket.user?.id;
      const position = parseInt(data.position);

      // Enhanced validation with better error messages
      if (!gameId || typeof gameId !== 'string') {
        return socket.emit('MEMORY_GAME_ERROR', { 
          message: 'Valid game ID required.' 
        });
      }

      if (!playerId || typeof playerId !== 'string') {
        return socket.emit('MEMORY_GAME_ERROR', { 
          message: 'Valid player ID required.' 
        });
      }

      if (position === undefined || position < 0 || !Number.isInteger(position)) {
        return socket.emit('MEMORY_GAME_ERROR', { 
          message: 'Valid card position required.' 
        });
      }

      const gameState = this.games.get(gameId);
      if (!gameState) {
        return socket.emit('MEMORY_GAME_ERROR', { 
          message: 'Game not found.' 
        });
      }

      // Check game status
      if (gameState.status !== 'playing') {
        return socket.emit('MEMORY_GAME_ERROR', { 
          message: 'Game is not active.' 
        });
      }

      // Check if it's player's turn
      if (gameState.currentTurnPlayerId !== playerId) {
        return socket.emit('MEMORY_GAME_ERROR', { 
          message: 'Not your turn.' 
        });
      }

      // Check if processing cards (prevent rapid clicks)
      if (gameState.processingCards) {
        return socket.emit('MEMORY_GAME_ERROR', { 
          message: 'Please wait, cards are being processed.' 
        });
      }

      // Validate position bounds
      if (position >= gameState.board.length) {
        return socket.emit('MEMORY_GAME_ERROR', { 
          message: 'Invalid card position.' 
        });
      }

      const card = gameState.board[position];
      
      // Check if card can be selected
      if (card.isFlipped || card.isMatched) {
        return socket.emit('MEMORY_GAME_ERROR', { 
          message: 'Card already revealed or matched.' 
        });
      }

      // Check if already selected 2 cards
      if (gameState.selectedCards.length >= 2) {
        return socket.emit('MEMORY_GAME_ERROR', { 
          message: 'Maximum 2 cards per turn.' 
        });
      }

      // Check if card already selected this turn
      if (gameState.selectedCards.some(selected => selected.position === position)) {
        return socket.emit('MEMORY_GAME_ERROR', { 
          message: 'Card already selected this turn.' 
        });
      }

      // Set processing flag to prevent race conditions
      gameState.processingCards = true;

      // Flip card immediately
      card.isFlipped = true;
      gameState.selectedCards.push({
        position: position,
        symbol: card.symbol,
        cardId: card.id
      });

      // Bot memory update would go here if implemented

      // Emit card opened with minimal data to reduce lag
      this.io.to(`game:${gameId}`).emit('MEMORY_CARD_OPENED', {
        position: position,
        symbol: card.symbol,
        playerId: playerId,
        selectedCount: gameState.selectedCards.length
      });

      // If 2 cards selected, process match immediately
      if (gameState.selectedCards.length === 2) {
        // Clear timer now that turn is complete
        this.clearTurnTimer(gameId);
        // Process match with minimal delay for better UX
        setTimeout(() => this.processMatch(gameId), 100);
      } else {
        // Reset processing flag for first card
        gameState.processingCards = false;
      }

    } catch (error) {
      logger.error(`Memory Game: Select card error for game ${gameId}, player ${playerId}, position ${position}:`, error);
      // Reset processing flag on error
      const gameState = this.games.get(gameId);
      if (gameState) {
        gameState.processingCards = false;
        // Revert optimistic card flip if it was set
        if (gameState.board[position]) {
          gameState.board[position].isFlipped = false;
        }
        // Remove from selected cards if it was added
        gameState.selectedCards = gameState.selectedCards.filter(card => card.position !== position);
      }
      
      // Provide more specific error message
      let errorMessage = 'Failed to select card.';
      if (error.message.includes('turn')) {
        errorMessage = 'Not your turn to play.';
      } else if (error.message.includes('already')) {
        errorMessage = 'Card already selected or revealed.';
      } else if (error.message.includes('processing')) {
        errorMessage = 'Please wait, processing previous selection.';
      } else if (error.message.includes('position')) {
        errorMessage = 'Invalid card position.';
      }
      
      socket.emit('MEMORY_GAME_ERROR', { 
        message: errorMessage,
        code: 'CARD_SELECTION_FAILED',
        position: position
      });
    }
  }

  async processMatch(gameId) {
    try {
      const gameState = this.games.get(gameId);
      if (!gameState || gameState.selectedCards.length !== 2) {
        return;
      }

      const [card1, card2] = gameState.selectedCards;
      const currentPlayer = gameState.players.find(p => p.id === gameState.currentTurnPlayerId);

      if (card1.symbol === card2.symbol) {
        // Match found!
        gameState.board[card1.position].isMatched = true;
        gameState.board[card2.position].isMatched = true;
        gameState.matchedPairs++;
        
        // Update score
        gameState.scores[gameState.currentTurnPlayerId] += 10;
        currentPlayer.score += 10;

        // Update player score in database (non-blocking)
        gameService.updatePlayerScore(gameId, gameState.currentTurnPlayerId, currentPlayer.score).catch(err => {
          logger.error('Failed to update player score in processMatch:', err);
        });

        // Bot memory update for matched cards
        this.updateBotMemories(gameId, [card1, card2], true);

        // Emit match event with minimal data
        this.io.to(`game:${gameId}`).emit('MEMORY_CARDS_MATCHED', {
          positions: [card1.position, card2.position],
          playerId: gameState.currentTurnPlayerId,
          newScore: gameState.scores[gameState.currentTurnPlayerId],
          matchedPairs: gameState.matchedPairs
        });

        // Check if game finished
        if (gameState.matchedPairs >= gameState.totalPairs) {
          await this.endGame(gameId, 'game_completed');
          return;
        }

        // Player gets another turn - reset immediately
        gameState.selectedCards = [];
        gameState.processingCards = false;
        this.startTurnTimer(gameId);
        
        // Check if current player is a bot for next turn
        this.checkAndHandleBotTurn(gameId, gameState.currentTurnPlayerId).catch(err => {
          logger.error('Error checking bot turn in processMatch:', err);
        });

      } else {
        // No match - flip back immediately and change turn
        gameState.board[card1.position].isFlipped = false;
        gameState.board[card2.position].isFlipped = false;
        
        // Bot memory update for mismatched cards
        this.updateBotMemories(gameId, [card1, card2], false);
        
        // Emit mismatch event with immediate flip back
        this.io.to(`game:${gameId}`).emit('MEMORY_CARDS_MISMATCHED', {
          positions: [card1.position, card2.position],
          symbols: [card1.symbol, card2.symbol],
          nextPlayerName: gameState.players[(gameState.currentTurnIndex + 1) % gameState.players.length].name
        });

        // Change turn immediately
        this.nextTurn(gameId);
      }

      // Update database (non-blocking)
      gameService.updateGameState(gameId, gameState.board, gameState.currentTurnIndex, 'PLAYING', null).catch(err => {
        logger.error('Failed to update game state in processMatch:', err);
      });

    } catch (error) {
      logger.error(`Memory Game: Process match error:`, error);
      const gameState = this.games.get(gameId);
      if (gameState) {
        gameState.selectedCards = [];
        gameState.processingCards = false;
      }
    }
  }

  nextTurn(gameId) {
    const gameState = this.games.get(gameId);
    if (!gameState) return;

    // Move to next player
    gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.players.length;
    gameState.currentTurnPlayerId = gameState.players[gameState.currentTurnIndex].id;
    gameState.selectedCards = [];
    gameState.processingCards = false;

    const currentPlayer = gameState.players[gameState.currentTurnIndex];

    // Emit turn change with minimal data
    this.io.to(`game:${gameId}`).emit('MEMORY_TURN_CHANGED', {
      currentPlayerId: currentPlayer.id,
      currentPlayerName: currentPlayer.name
    });

    // Also emit the old event name for compatibility
    this.io.to(`game:${gameId}`).emit('MEMORY_GAME_CURRENT_TURN', {
      currentPlayer: currentPlayer.id,
      currentPlayerName: currentPlayer.name
    });

    // Start timer for new player
    this.startTurnTimer(gameId);
    
    // Check if new current player is a bot
    this.checkAndHandleBotTurn(gameId, currentPlayer.id).catch(err => {
      logger.error('Error checking bot turn in nextTurn:', err);
    });
  }

  startTurnTimer(gameId) {
    this.clearTurnTimer(gameId);

    const gameState = this.games.get(gameId);
    if (!gameState) return;

    const currentPlayer = gameState.players.find(p => p.id === gameState.currentTurnPlayerId);

    // Start timer
    const timer = setTimeout(() => {
      this.handleTurnTimeout(gameId);
    }, this.TURN_TIMER);

    this.turnTimers.set(gameId, timer);

    // Emit timer start
    this.io.to(`game:${gameId}`).emit('MEMORY_TURN_TIMER', {
      playerId: gameState.currentTurnPlayerId,
      playerName: currentPlayer?.name || 'Unknown',
      timeLeft: this.TURN_TIMER / 1000
    });

    // Send countdown updates less frequently to reduce lag
    let timeLeft = this.TURN_TIMER / 1000;
    const countdownInterval = setInterval(() => {
      timeLeft -= 3;
      if (timeLeft > 0) {
        this.io.to(`game:${gameId}`).emit('MEMORY_TIMER_UPDATE', {
          timeLeft: timeLeft
        });
      } else {
        clearInterval(countdownInterval);
      }
    }, 3000); // Update every 3 seconds instead of 1

    this.countdownIntervals.set(gameId, countdownInterval);
  }

  clearTurnTimer(gameId) {
    if (this.turnTimers.has(gameId)) {
      clearTimeout(this.turnTimers.get(gameId));
      this.turnTimers.delete(gameId);
    }
    if (this.countdownIntervals.has(gameId)) {
      clearInterval(this.countdownIntervals.get(gameId));
      this.countdownIntervals.delete(gameId);
    }
  }

  async handleTurnTimeout(gameId) {
    const gameState = this.games.get(gameId);
    if (!gameState) return;

    const currentPlayer = gameState.players.find(p => p.id === gameState.currentTurnPlayerId);
    const nextPlayerIndex = (gameState.currentTurnIndex + 1) % gameState.players.length;
    const nextPlayer = gameState.players[nextPlayerIndex];

    // Handle lifeline deduction for missed turn
    if (currentPlayer && gameState.lifelines[currentPlayer.id] > 0) {
      gameState.lifelines[currentPlayer.id] -= 1;
      gameState.missedTurns[currentPlayer.id] = (gameState.missedTurns[currentPlayer.id] || 0) + 1;

      // Emit lifeline lost event
      this.io.to(`game:${gameId}`).emit('MEMORY_LIFELINE_LOST', {
        playerId: currentPlayer.id,
        playerName: currentPlayer.name,
        remainingLifelines: gameState.lifelines[currentPlayer.id]
      });

      // Check if player should be eliminated (0 lifelines remaining)
      if (gameState.lifelines[currentPlayer.id] === 0) {
        // Emit player eliminated event
        this.io.to(`game:${gameId}`).emit('MEMORY_PLAYER_ELIMINATED', {
          playerId: currentPlayer.id,
          playerName: currentPlayer.name,
          reason: 'No lifelines remaining'
        });

        // Remove player from game
        gameState.players = gameState.players.filter(p => p.id !== currentPlayer.id);
        delete gameState.scores[currentPlayer.id];
        delete gameState.lifelines[currentPlayer.id];
        delete gameState.missedTurns[currentPlayer.id];

        // Check if only one player remains
        if (gameState.players.length === 1) {
          await this.endGame(gameId, 'opponent_eliminated');
          return;
        }

        // Adjust current turn index if needed
        if (gameState.currentTurnIndex >= gameState.players.length) {
          gameState.currentTurnIndex = 0;
        }
      }
    }

    // Clear any selected cards and flip them back
    const flippedPositions = [];
    gameState.selectedCards.forEach(selected => {
      gameState.board[selected.position].isFlipped = false;
      flippedPositions.push(selected.position);
    });

    // Emit card flip back event if there are cards to flip
    if (flippedPositions.length > 0) {
      this.io.to(`game:${gameId}`).emit('MEMORY_CARDS_TIMEOUT_FLIP_BACK', {
        positions: flippedPositions
      });
    }

    // Emit turn skipped event
    this.io.to(`game:${gameId}`).emit('MEMORY_TURN_SKIPPED', {
      skippedPlayer: currentPlayer?.name || 'Unknown',
      skippedPlayerId: currentPlayer?.id,
      nextPlayerName: nextPlayer?.name || 'Unknown',
      reason: 'timeout',
      flippedBackPositions: flippedPositions
    });

    // Move to next turn (only if player wasn't eliminated)
    if (gameState.players.find(p => p.id === currentPlayer?.id)) {
      this.nextTurn(gameId);
    } else {
      // Player was eliminated, just start timer for current player
      gameState.currentTurnPlayerId = gameState.players[gameState.currentTurnIndex].id;
      this.startTurnTimer(gameId);
    }
  }

  async endGame(gameId, endReason = 'game_completed') {
    try {
      const gameState = this.games.get(gameId);
      if (!gameState) {
        logger.warn(`Cannot end game ${gameId}: game state not found`);
        return;
      }

      this.clearTurnTimer(gameId);

      // Get game info for prize pool
      const game = await gameService.getGameById(gameId);
      const prizePool = game?.prizePool || 0;
      
      // Find winner and create leaderboard
      const leaderboard = gameState.players
        .map(player => ({
          id: player.id,
          name: player.name,
          score: gameState.scores[player.id] || 0,
          lifelines: gameState.lifelines[player.id] || 0
        }))
        .sort((a, b) => b.score - a.score);

      // Determine winner based on end reason
      let winnerId = null;
      let highestScore = 0;
      
      if (endReason === 'opponent_eliminated' || endReason === 'opponent_quit') {
        // If opponent was eliminated/quit, the remaining player wins
        winnerId = gameState.players.length > 0 ? gameState.players[0].id : null;
        highestScore = winnerId ? (gameState.scores[winnerId] || 0) : 0;
      } else if (endReason === 'game_completed') {
        // Normal completion - highest score wins
        winnerId = leaderboard.length > 0 ? leaderboard[0].id : null;
        highestScore = leaderboard.length > 0 ? leaderboard[0].score : 0;
      } else if (endReason === 'network_issue') {
        // Network issue - no winner, refund all
        winnerId = null;
        highestScore = 0;
      }

      // Set win amounts in leaderboard
      leaderboard.forEach(player => {
        player.winAmount = player.id === winnerId ? prizePool : 0;
        player.isWinner = player.id === winnerId;
      });

      const winner = gameState.players.find(p => p.id === winnerId);

      console.log(`Memory Game: Ending game ${gameId} with reason: ${endReason}, prize pool: ${prizePool}`);
      console.log(`Memory Game: Leaderboard:`, leaderboard);
      console.log(`Memory Game: Final scores:`, gameState.scores);

      // Update database
      await gameService.updateGameState(gameId, gameState.board, gameState.currentTurnIndex, 'FINISHED', winnerId);

      // Determine end reason message for display
      let reasonMessage = null;
      switch (endReason) {
        case 'opponent_quit':
          reasonMessage = 'Opponent left the game';
          break;
        case 'opponent_eliminated':
          reasonMessage = 'Opponent eliminated (no lifelines remaining)';
          break;
        case 'network_issue':
          reasonMessage = 'Game ended due to network issues - all players refunded';
          break;
        case 'game_completed':
          reasonMessage = null; // Normal completion, no special message needed
          break;
        default:
          reasonMessage = `Game ended: ${endReason}`;
      }

      // Emit game end with complete information including reason
      this.io.to(`game:${gameId}`).emit('MEMORY_GAME_ENDED', {
        winner: winner,
        winnerId: winnerId,
        finalScores: gameState.scores,
        players: gameState.players,
        prizePool: prizePool,
        leaderboard: leaderboard,
        totalPlayers: gameState.players.length,
        reason: reasonMessage,
        endReason: endReason,
        gameStats: {
          totalPairs: gameState.totalPairs,
          matchedPairs: gameState.matchedPairs,
          winnerScore: highestScore,
          endReason: endReason
        }
      });

      // Process winnings based on end reason
      let winningsResult = null;
      if (endReason === 'network_issue') {
        // Network issues - refund all players
        winningsResult = await this.safeProcessWinnings(gameId, null, 'network_issue');
      } else if (winnerId) {
        // Process winnings for the winner
        winningsResult = await this.safeProcessWinnings(gameId, winnerId, endReason);
      }
      
      if (winningsResult) {
        logger.info(`Winnings processing result for game ${gameId}:`, winningsResult);
      }

      // Clean up
      this.games.delete(gameId);
      this.cleanupGameBots(gameId); // Clean up any bots
      
      // Don't delete from processedWinnings here - let it be cleaned up naturally to prevent race conditions

      // Integrate with advanced bot performance tracking
      try {
        const participants = gameState.players.map(player => ({
          userId: player.id,
          user: { isBot: player.isBot || false }
        }));
        
        await GameplayController.handleGameEnd(gameId, winnerId, participants);
        await PerformanceBalancer.recordGameOutcome(gameId, winnerId, participants);
      } catch (botError) {
        logger.error(`Advanced bot system integration error for game ${gameId}:`, botError);
      }

      logger.info(`Memory Game: Game ${gameId} ended with reason: ${endReason}. Winner: ${winnerId} with score: ${highestScore}`);
    } catch (error) {
      logger.error(`Memory Game: End game error for ${gameId}:`, error);
    }
  }

  async joinRoom(socket, { roomId, playerId, playerName }) {
    try {
      let gameState = this.games.get(roomId);
      
      if (!gameState) {
        const gameFromDb = await gameService.getGameById(roomId);
        if (!gameFromDb) {
          return socket.emit('MEMORY_GAME_ERROR', { message: 'Game not found.' });
        }

        // Recreate game state from database
        const players = gameFromDb.participants.map((p, index) => ({
          id: p.userId,
          name: p.user?.name || `Player ${index + 1}`,
          position: index,
          score: 0
        }));

        gameState = {
          board: gameFromDb.gameData || [],
          players: players,
          currentTurnIndex: gameFromDb.currentTurn || 0,
          currentTurnPlayerId: players[gameFromDb.currentTurn || 0]?.id,
          selectedCards: [],
          scores: {},
          lifelines: {},
          missedTurns: {},
          matchedPairs: 0,
          totalPairs: 15,
          status: gameFromDb.status,
          processingCards: false
        };

        // Initialize scores and lifelines
        players.forEach(player => {
          gameState.scores[player.id] = 0;
          gameState.lifelines[player.id] = 3;
          gameState.missedTurns[player.id] = 0;
        });

        this.games.set(roomId, gameState);
      }

      socket.join(`game:${roomId}`);

      // Get game info for prize pool
      const gameFromDb = await gameService.getGameById(roomId);
      
      // Send current state to joining player
      socket.emit('MEMORY_CURRENT_STATE', {
        board: gameState.board.map(card => ({
          id: card.id,
          isFlipped: card.isFlipped,
          isMatched: card.isMatched,
          symbol: card.isFlipped || card.isMatched ? card.symbol : null,
        })),
        players: gameState.players,
        currentPlayerId: gameState.currentTurnPlayerId,
        scores: gameState.scores,
        lifelines: gameState.lifelines,
        matchedPairs: gameState.matchedPairs,
        status: gameState.status,
      });

      // If player is reconnecting and it's their turn, restart timer
      if (gameState.currentTurnPlayerId === playerId && gameState.status === 'playing') {
        // Only restart timer if no cards are selected or processing
        if (gameState.selectedCards.length === 0 && !gameState.processingCards) {
          this.startTurnTimer(roomId);
        }
      }

      logger.info(`Memory Game: Player ${playerName} joined room ${roomId}`);
    } catch (error) {
      logger.error(`Memory Game: Join room error:`, error);
      socket.emit('MEMORY_GAME_ERROR', { message: 'Failed to join room.' });
    }
  }

  async handlePlayerLeave(socket, { roomId, playerId }) {
    try {
      const gameState = this.games.get(roomId);
      if (!gameState) return;

      await this.handlePlayerExit(roomId, playerId, 'left');
    } catch (error) {
      logger.error(`Memory Game: Player leave error:`, error);
    }
  }

  async handlePlayerDisconnect(socket) {
    try {
      // Find all games this socket is part of
      const playerId = socket.user?.id;
      if (!playerId) return;

      for (const [roomId, gameState] of this.games.entries()) {
        const player = gameState.players.find(p => p.id === playerId);
        if (player) {
          await this.handlePlayerExit(roomId, playerId, 'disconnected');
        }
      }
    } catch (error) {
      logger.error(`Memory Game: Player disconnect error:`, error);
    }
  }

  async handlePlayerExit(roomId, playerId, reason) {
    try {
      const gameState = this.games.get(roomId);
      if (!gameState || gameState.status !== 'playing') return;

      const leavingPlayer = gameState.players.find(p => p.id === playerId);
      if (!leavingPlayer) return;

      // Clear timers
      this.clearTurnTimer(roomId);

      // If it's a 2-player game, handle based on reason
      if (gameState.players.length === 2) {
        if (reason === 'disconnected' || reason === 'network_issue') {
          // For network issues, end game with network_issue reason
          logger.info(`Memory Game: Game ${roomId} ended due to network issue, will refund both players`);
          await this.endGame(roomId, 'network_issue');
        } else {
          // Player intentionally left, other player wins
          const remainingPlayer = gameState.players.find(p => p.id !== playerId);
          
          // Remove leaving player from game state
          gameState.players = gameState.players.filter(p => p.id !== playerId);
          delete gameState.scores[playerId];
          delete gameState.lifelines[playerId];
          delete gameState.missedTurns[playerId];
          
          // End game with opponent_quit reason
          await this.endGame(roomId, 'opponent_quit');
          logger.info(`Memory Game: Game ${roomId} ended due to player ${reason}. Winner: ${remainingPlayer?.id}`);
        }
      } else {
        // For games with more than 2 players, just remove the player and continue
        gameState.players = gameState.players.filter(p => p.id !== playerId);
        delete gameState.scores[playerId];
        delete gameState.lifelines[playerId];
        delete gameState.missedTurns[playerId];

        // If it was the leaving player's turn, move to next player
        if (gameState.currentTurnPlayerId === playerId) {
          // Adjust current turn index if needed
          const leavingPlayerIndex = gameState.players.findIndex(p => p.id === playerId);
          if (leavingPlayerIndex !== -1 && gameState.currentTurnIndex >= leavingPlayerIndex) {
            gameState.currentTurnIndex = Math.max(0, gameState.currentTurnIndex - 1);
          }
          this.nextTurn(roomId);
        }

        // Check if only one player remains
        if (gameState.players.length === 1) {
          await this.endGame(roomId, 'opponent_quit');
        } else {
          // Notify remaining players
          this.io.to(`game:${roomId}`).emit('MEMORY_PLAYER_LEFT', {
            playerId: playerId,
            playerName: leavingPlayer.name,
            reason: reason,
            remainingPlayers: gameState.players
          });
        }
      }

      // Clean up game if no players left
      if (gameState.players.length === 0) {
        this.games.delete(roomId);
      }
    } catch (error) {
      logger.error(`Memory Game: Handle player exit error:`, error);
    }
  }

  // Check if current player is a bot and handle bot turn
  async checkAndHandleBotTurn(gameId, playerId) {
    try {
      const user = await prisma.user.findUnique({ where: { id: playerId } });
      if (user && user.isBot) {
        logger.info(`🤖 Bot turn for ${user.name} in game ${gameId}`);
        
        // Use simple bot logic to reduce lag
        setTimeout(() => {
          this.handleBasicBotTurn(gameId, playerId);
        }, 1000 + Math.random() * 2000); // 1-3 second delay
      }
    } catch (error) {
      logger.error(`Error checking bot turn for player ${playerId}:`, error);
      // Fallback to basic bot logic
      setTimeout(() => {
        this.handleBasicBotTurn(gameId, playerId);
      }, 1500);
    }
  }

  // Human-like bot logic with memory and strategy
  async handleBasicBotTurn(gameId, botPlayerId) {
    try {
      const gameState = this.games.get(gameId);
      if (!gameState || gameState.status !== 'playing' || gameState.currentTurnPlayerId !== botPlayerId) {
        return;
      }

      // Get or create bot memory for this game
      const botMemoryKey = `${gameId}_${botPlayerId}`;
      if (!this.botMemories) this.botMemories = new Map();
      if (!this.botMemories.has(botMemoryKey)) {
        this.botMemories.set(botMemoryKey, {
          rememberedCards: new Map(), // position -> symbol
          skillLevel: Math.random() * 0.7 + 0.3, // 30-100% skill
          patience: Math.random() * 0.5 + 0.5, // 50-100% patience
          lastMove: null
        });
      }

      const botMemory = this.botMemories.get(botMemoryKey);
      const availableCards = gameState.board
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => !card.isFlipped && !card.isMatched);

      if (availableCards.length === 0) return;

      // Human-like thinking delay
      const thinkingTime = 1000 + Math.random() * 2000; // 1-3 seconds
      await new Promise(resolve => setTimeout(resolve, thinkingTime));

      // Try to find a match from memory first
      let firstCard = this.findMemoryMatch(availableCards, botMemory, gameState.board);
      
      if (!firstCard) {
        // If no memory match, use strategy-based selection
        firstCard = this.selectWithStrategy(availableCards, botMemory);
      }

      logger.info(`🤖 Bot ${botPlayerId} selecting first card at position ${firstCard.index}`);
      
      await this.selectCard({ user: { id: botPlayerId }, emit: () => {} }, {
        gameId: gameId,
        playerId: botPlayerId,
        position: firstCard.index
      });

      // Wait before second card with human-like timing
      const secondCardDelay = 800 + Math.random() * 1500; // 0.8-2.3 seconds
      setTimeout(async () => {
        try {
          const updatedGameState = this.games.get(gameId);
          if (!updatedGameState || updatedGameState.currentTurnPlayerId !== botPlayerId) {
            return;
          }

          if (updatedGameState.selectedCards.length >= 2) {
            return;
          }

          // For second card, try to match with first card
          const secondCard = this.findMatchingCard(firstCard, availableCards, botMemory, updatedGameState.board);
          
          if (secondCard) {
            logger.info(`🤖 Bot ${botPlayerId} attempting match with card at position ${secondCard.index}`);
          } else {
            logger.info(`🤖 Bot ${botPlayerId} selecting exploratory card`);
          }
          
          await this.selectCard({ user: { id: botPlayerId }, emit: () => {} }, {
            gameId: gameId,
            playerId: botPlayerId,
            position: secondCard.index
          });

        } catch (error) {
          logger.error(`Error in bot second card selection:`, error);
        }
      }, secondCardDelay);

    } catch (error) {
      logger.error(`Error in bot turn for ${botPlayerId}:`, error);
    }
  }

  // Find a card that matches something in memory
  findMemoryMatch(availableCards, botMemory, board) {
    for (const [position, symbol] of botMemory.rememberedCards) {
      // Find matching symbol in available cards
      const matchingCard = availableCards.find(({ card, index }) => {
        const rememberedSymbol = botMemory.rememberedCards.get(index);
        return rememberedSymbol === symbol && index !== position;
      });
      
      if (matchingCard && Math.random() < botMemory.skillLevel) {
        return availableCards.find(({ index }) => index === position);
      }
    }
    return null;
  }

  // Find a card that matches the first selected card
  findMatchingCard(firstCard, availableCards, botMemory, board) {
    const firstCardSymbol = board[firstCard.index].symbol;
    
    // Try to find match in memory
    for (const [position, symbol] of botMemory.rememberedCards) {
      if (symbol === firstCardSymbol && position !== firstCard.index) {
        const matchCard = availableCards.find(({ index }) => index === position);
        if (matchCard && Math.random() < botMemory.skillLevel) {
          return matchCard;
        }
      }
    }
    
    // If no memory match, select randomly (human-like exploration)
    const remainingCards = availableCards.filter(({ index }) => index !== firstCard.index);
    if (remainingCards.length > 0) {
      return remainingCards[Math.floor(Math.random() * remainingCards.length)];
    }
    
    return null;
  }

  // Select card with strategy (not purely random)
  selectWithStrategy(availableCards, botMemory) {
    // Sometimes pick from memory, sometimes explore new areas
    if (botMemory.rememberedCards.size > 0 && Math.random() < 0.6) {
      // Pick a remembered card
      const rememberedPositions = Array.from(botMemory.rememberedCards.keys());
      const validPositions = rememberedPositions.filter(pos => 
        availableCards.some(({ index }) => index === pos)
      );
      
      if (validPositions.length > 0) {
        const chosenPos = validPositions[Math.floor(Math.random() * validPositions.length)];
        return availableCards.find(({ index }) => index === chosenPos);
      }
    }
    
    // Explore new card
    return availableCards[Math.floor(Math.random() * availableCards.length)];
  }

  // Efficient bot memory system
  async updateBotMemories(gameId, revealedCards, wasSuccessful) {
    try {
      if (!this.botMemories) this.botMemories = new Map();
      
      const gameState = this.games.get(gameId);
      if (!gameState) return;

      // Update memory for all bot players in this game
      for (const player of gameState.players) {
        const botMemoryKey = `${gameId}_${player.id}`;
        if (this.botMemories.has(botMemoryKey)) {
          const botMemory = this.botMemories.get(botMemoryKey);
          
          // Remember revealed cards based on skill level
          revealedCards.forEach(card => {
            if (Math.random() < botMemory.skillLevel) {
              botMemory.rememberedCards.set(card.position, card.symbol);
            }
          });
          
          // Occasionally forget cards (human-like)
          if (Math.random() < 0.1) {
            const positions = Array.from(botMemory.rememberedCards.keys());
            if (positions.length > 0) {
              const forgetPos = positions[Math.floor(Math.random() * positions.length)];
              botMemory.rememberedCards.delete(forgetPos);
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error updating bot memories:`, error);
    }
  }

  // Clean up bot memories when game ends
  cleanupGameBots(gameId) {
    try {
      if (this.botMemories) {
        // Remove bot memories for this game
        const keysToDelete = [];
        for (const [key] of this.botMemories) {
          if (key.startsWith(`${gameId}_`)) {
            keysToDelete.push(key);
          }
        }
        
        keysToDelete.forEach(key => {
          this.botMemories.delete(key);
        });
        
        if (keysToDelete.length > 0) {
          logger.info(`Cleaned up ${keysToDelete.length} bot memories for game ${gameId}`);
        }
      }
    } catch (error) {
      logger.error(`Error cleaning up bot memories for game ${gameId}:`, error);
    }
  }
}

module.exports = MemoryGameService;