// MemoryGameService.js - Complete Memory Game Implementation
const logger = require('../config/logger');
const gameService = require('./gameService');
const prisma = require('../config/database');

class MemoryGameService {
  constructor(io) {
    this.io = io;
    this.games = new Map();
    this.TURN_TIMER = 15000; // 15 seconds total for 2 cards
    this.turnTimers = new Map();
    this.countdownIntervals = new Map();
    this.processedWinnings = new Set(); // Track games where winnings have been processed
  }

  setupSocketHandlers(socket) {
    socket.on('START_MEMORY_GAME', (data) => this.startGame(data));
    socket.on('SELECT_MEMORY_CARD', (data) => this.selectCard(socket, data));
    socket.on('selectCard', (data) => this.selectCard(socket, data));
    socket.on('JOIN_MEMORY_ROOM', (data) => this.joinRoom(socket, data));
    socket.on('LEAVE_MEMORY_GAME', (data) => this.handlePlayerLeave(socket, data));
    socket.on('disconnect', () => this.handlePlayerDisconnect(socket));
  }

  async safeProcessWinnings(gameId, winnerId, reason = 'game_completed') {
    // Check if winnings have already been processed for this game
    if (this.processedWinnings.has(gameId)) {
      logger.warn(`Winnings already processed for game ${gameId}, skipping duplicate processing`);
      return;
    }

    // Mark as processed immediately to prevent race conditions
    this.processedWinnings.add(gameId);

    try {
      const game = await gameService.getGameById(gameId);
      if (!game) {
        logger.error(`Game ${gameId} not found for winnings processing`);
        this.processedWinnings.delete(gameId);
        return;
      }

      // Handle different end game scenarios
      if (reason === 'network_issue' || reason === 'server_error') {
        // Refund all players for network/server issues
        logger.info(`Refunding all players for game ${gameId} due to ${reason}`);
        const walletService = require('./walletService');
        for (const participant of game.participants) {
          await walletService.creditWallet(
            participant.userId, 
            game.entryFee, 
            'REFUND', 
            gameId,
            `Game refund due to ${reason}`
          );
        }
      } else if (winnerId && reason === 'game_completed') {
        // Only credit winner for legitimate game completion
        logger.info(`Processing winnings for legitimate game completion: ${gameId}, winner: ${winnerId}`);
        await gameService.processGameWinnings(gameId);
      } else if (winnerId && (reason === 'opponent_quit' || reason === 'opponent_eliminated')) {
        // Credit winner when opponent quits or is eliminated
        logger.info(`Processing winnings for ${reason}: ${gameId}, winner: ${winnerId}`);
        await gameService.processGameWinnings(gameId);
      } else {
        logger.warn(`No valid winner or reason for game ${gameId}, no winnings processed. Winner: ${winnerId}, Reason: ${reason}`);
      }
    } catch (error) {
      logger.error(`Failed to process game winnings for game ${gameId}:`, error);
      // Remove from processed set if it failed, so it can be retried
      this.processedWinnings.delete(gameId);
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

      // Emit card opened with optimized data and game state sync
      this.io.to(`game:${gameId}`).emit('MEMORY_CARD_OPENED', {
        position: position,
        symbol: card.symbol,
        playerId: playerId,
        selectedCount: gameState.selectedCards.length,
        timestamp: Date.now(),
        gameState: {
          scores: gameState.scores,
          lifelines: gameState.lifelines,
          currentTurnPlayerId: gameState.currentTurnPlayerId,
          matchedPairs: gameState.matchedPairs
        }
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
      logger.error(`Memory Game: Select card error:`, error);
      // Reset processing flag on error
      const gameState = this.games.get(data.gameId || data.roomId);
      if (gameState) {
        gameState.processingCards = false;
      }
      socket.emit('MEMORY_GAME_ERROR', { message: 'Failed to select card.' });
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
          logger.error('Failed to update player score:', err);
        });

        // Emit match event immediately
        this.io.to(`game:${gameId}`).emit('MEMORY_CARDS_MATCHED', {
          positions: [card1.position, card2.position],
          playerId: gameState.currentTurnPlayerId,
          playerName: currentPlayer.name,
          scores: gameState.scores,
          matchedPairs: gameState.matchedPairs
        });

        // Check if game finished
        if (gameState.matchedPairs >= gameState.totalPairs) {
          await this.endGame(gameId);
          return;
        }

        // Player gets another turn - reset immediately
        gameState.selectedCards = [];
        gameState.processingCards = false;
        this.startTurnTimer(gameId);

      } else {
        // No match - flip back immediately and change turn
        gameState.board[card1.position].isFlipped = false;
        gameState.board[card2.position].isFlipped = false;
        
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
        logger.error('Failed to update game state:', err);
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

    // Emit turn change
    this.io.to(`game:${gameId}`).emit('MEMORY_TURN_CHANGED', {
      currentPlayer: currentPlayer,
      currentPlayerId: currentPlayer.id,
      currentPlayerName: currentPlayer.name,
      scores: gameState.scores
    });

    // Also emit the old event name for compatibility
    this.io.to(`game:${gameId}`).emit('MEMORY_GAME_CURRENT_TURN', {
      currentPlayer: currentPlayer.id,
      currentPlayerName: currentPlayer.name,
      players: gameState.players
    });

    // Start timer for new player
    this.startTurnTimer(gameId);
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

    // Send countdown updates
    let timeLeft = this.TURN_TIMER / 1000;
    const countdownInterval = setInterval(() => {
      timeLeft--;
      if (timeLeft > 0) {
        this.io.to(`game:${gameId}`).emit('MEMORY_TIMER_UPDATE', {
          timeLeft: timeLeft
        });
      } else {
        clearInterval(countdownInterval);
      }
    }, 1000);

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
          await this.endGame(gameId);
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

  async endGame(gameId) {
    try {
      const gameState = this.games.get(gameId);
      if (!gameState) return;

      this.clearTurnTimer(gameId);

      // Find winner and create leaderboard
      const prizePool = (await gameService.getGameById(gameId))?.prizePool || 0;
      const leaderboard = gameState.players
        .map(player => ({
          id: player.id,
          name: player.name,
          score: gameState.scores[player.id] || 0,
        }))
        .sort((a, b) => b.score - a.score);

      const winnerId = leaderboard.length > 0 ? leaderboard[0].id : null;
      const highestScore = leaderboard.length > 0 ? leaderboard[0].score : 0;

      leaderboard.forEach(player => {
        player.winAmount = player.id === winnerId ? prizePool : 0;
      });

      const winner = gameState.players.find(p => p.id === winnerId);

      // Get game info for prize pool
      // (already fetched above as prizePool)
      // const game = await gameService.getGameById(gameId);
      // const prizePool = game?.prizePool || 0;

      console.log(`Memory Game: Ending game ${gameId} with prize pool: ${prizePool}`);
      // console.log(`Memory Game: Game object:`, JSON.stringify(game, null, 2));
      console.log(`Memory Game: Leaderboard:`, leaderboard);
      console.log(`Memory Game: Final scores:`, gameState.scores);

      // Update database
      await gameService.updateGameState(gameId, gameState.board, gameState.currentTurnIndex, 'FINISHED', winnerId);

      // Emit game end with complete information
      this.io.to(`game:${gameId}`).emit('MEMORY_GAME_ENDED', {
        winner: winner,
        winnerId: winnerId,
        finalScores: gameState.scores,
        players: gameState.players,
        prizePool: prizePool,
        leaderboard: leaderboard,
        totalPlayers: gameState.players.length,
        gameStats: {
          totalPairs: gameState.totalPairs,
          matchedPairs: gameState.matchedPairs,
          winnerScore: highestScore
        }
      });

      // Process winnings only for legitimate game completion
      if (winnerId && gameState.matchedPairs >= gameState.totalPairs) {
        // Only credit winner if game was completed normally (all pairs matched)
        this.safeProcessWinnings(gameId, winnerId, 'game_completed').catch(err => {
          logger.error('Failed to process game winnings:', err);
        });
      } else if (winnerId && gameState.players.length === 1) {
        // Credit winner if only one player remains (others eliminated/quit)
        this.safeProcessWinnings(gameId, winnerId, 'opponent_eliminated').catch(err => {
          logger.error('Failed to process game winnings:', err);
        });
      }

      // Clean up
      this.games.delete(gameId);
      this.processedWinnings.delete(gameId); // Clean up processed winnings tracking

      logger.info(`Memory Game: Game ${gameId} ended. Winner: ${winnerId} with score: ${highestScore}`);
    } catch (error) {
      logger.error(`Memory Game: End game error:`, error);
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
          // For network issues, refund both players
          logger.info(`Memory Game: Game ${roomId} ended due to network issue, refunding both players`);
          await this.safeProcessWinnings(roomId, null, 'network_issue');
          
          // Notify players about refund
          this.io.to(`game:${roomId}`).emit('MEMORY_GAME_ENDED', {
            reason: 'Network issue - both players refunded',
            leaderboard: gameState.players.map(player => ({
              id: player.id,
              name: player.name,
              score: gameState.scores[player.id] || 0,
              isWinner: false,
              winAmount: 0
            })),
            prizePool: 0,
            totalPlayers: 2,
            gameStats: {
              totalPairs: gameState.totalPairs,
              matchedPairs: gameState.matchedPairs,
              endReason: 'network_issue'
            }
          });
        } else {
          // Player intentionally left, other player wins
          const remainingPlayer = gameState.players.find(p => p.id !== playerId);
          gameState.players = [remainingPlayer];
          delete gameState.scores[playerId];
          delete gameState.lifelines[playerId];
          delete gameState.missedTurns[playerId];
          
          // Process winnings for remaining player since opponent quit
          if (remainingPlayer) {
            this.safeProcessWinnings(roomId, remainingPlayer.id, 'opponent_quit').catch(err => {
              logger.error('Failed to process winnings for opponent quit:', err);
            });
          }
          
          await this.endGame(roomId);
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
          this.nextTurn(roomId);
        }

        // Notify remaining players
        this.io.to(`game:${roomId}`).emit('MEMORY_PLAYER_LEFT', {
          playerId: playerId,
          playerName: leavingPlayer.name,
          reason: reason,
          remainingPlayers: gameState.players
        });
      }

      // Clean up game if no players left
      if (gameState.players.length === 0) {
        this.games.delete(roomId);
        this.processedWinnings.delete(roomId);
      }
    } catch (error) {
      logger.error(`Memory Game: Handle player exit error:`, error);
    }
  }
}

module.exports = MemoryGameService;