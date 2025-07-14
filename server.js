const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: process.env.SOCKET_PING_TIMEOUT || 60000,
  pingInterval: process.env.SOCKET_PING_INTERVAL || 25000,
});

// Services
const prisma = require('./src/config/database');
const logger = require('./src/config/logger');
const socketManager = require('./src/services/socketManager');
const gameStateManager = require('./src/services/gameStateManager');
const matchmakingService = require('./src/services/matchmakingService');
const gameService = require('./src/services/gameService');
const botService = require('./src/services/BotService');
const MemoryGameService = require('./src/services/MemoryGame');
const PerformanceBalancer = require('./src/bot-system/services/PerformanceBalancer');
const { authenticateSocket } = require('./src/middleware/auth');
const { gameSchemas } = require('./src/validation/schemas');

// Initialize game services - Only Memory Game is implemented
const memoryGameService = new MemoryGameService(io);

// Socket authentication
io.use(authenticateSocket);

// Rate limiting for socket events
const socketRateLimits = new Map();

function checkRateLimit(userId, eventType, maxRequests = 5, windowMs = 10000) {
  const key = `${userId}_${eventType}`;
  const now = Date.now();
  
  if (!socketRateLimits.has(key)) {
    socketRateLimits.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  const limit = socketRateLimits.get(key);
  
  if (now > limit.resetTime) {
    // Reset the window
    limit.count = 1;
    limit.resetTime = now + windowMs;
    return true;
  }
  
  if (limit.count >= maxRequests) {
    return false;
  }
  
  limit.count++;
  return true;
}

// Cleanup rate limits periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, limit] of socketRateLimits.entries()) {
    if (now > limit.resetTime) {
      socketRateLimits.delete(key);
    }
  }
}, 60000); // Clean up every minute

// Socket connection handling
io.on('connection', (socket) => {
  const userId = socket.user.id;
  const userName = socket.user.name || 'Unknown';

  socketManager.addConnection(socket.id, userId);
  socket.join(`user:${userId}`);
  logger.info(`User connected: ${userName} (${userId})`);

  // Send connection confirmation with complete user data
  socket.emit('connected', { 
    userId, 
    userName,
    userPhone: socket.user.phoneNumber,
    message: 'Successfully connected to game server' 
  });
  
  logger.info(`📤 Sent connection confirmation to user ${userId} with name: ${userName}`);

  // Setup game handlers - Only Memory Game
  memoryGameService.setupSocketHandlers(socket);

  // Matchmaking events with enhanced rate limiting
  socket.on('joinMatchmaking', async (data) => {
    try {
      // Rate limit: max 3 requests per 10 seconds for matchmaking
      if (!checkRateLimit(userId, 'joinMatchmaking', 3, 10000)) {
        logger.warn(`Rate limit exceeded for joinMatchmaking by user ${userId}`);
        return socket.emit('matchmakingError', { 
          message: 'Too many requests. Please wait before trying again.',
          code: 'RATE_LIMIT_EXCEEDED'
        });
      }

      logger.info(`🎯 User ${userId} (${userName}) attempting to join matchmaking:`, data);
      
      const { error, value } = gameSchemas.joinMatchmaking.validate(data);
      if (error) {
        logger.warn(`Matchmaking validation error for user ${userId}:`, error.details[0].message);
        return socket.emit('matchmakingError', { message: error.details[0].message });
      }

      const { gameType, maxPlayers, entryFee } = value;
      
      // Validate game type enum - Only MEMORY is supported
      const validGameTypes = ['MEMORY'];
      if (!validGameTypes.includes(gameType)) {
        logger.warn(`Invalid game type ${gameType} for user ${userId}`);
        return socket.emit('matchmakingError', { message: 'Only Memory Game is available' });
      }

      // Validate maxPlayers - Memory game is 2 players only
      if (maxPlayers !== 2) {
        logger.warn(`Invalid maxPlayers ${maxPlayers} for user ${userId}`);
        return socket.emit('matchmakingError', { message: 'Memory Game supports 2 players only' });
      }

      // Validate entryFee
      if (entryFee < 0) {
        logger.warn(`Invalid entryFee ${entryFee} for user ${userId}`);
        return socket.emit('matchmakingError', { message: 'Invalid entry fee' });
      }

      logger.info(`📝 Matchmaking request validated for user ${userId} (${userName}): ${gameType} ${maxPlayers}P ₹${entryFee}`);

      // Check if user is already in queue to prevent duplicates
      const existingQueueEntry = await prisma.matchmakingQueue.findFirst({
        where: { userId }
      });

      if (existingQueueEntry) {
        logger.info(`User ${userId} already in matchmaking queue, sending existing status`);
        return socket.emit('matchmakingStatus', { 
          status: 'waiting', 
          message: 'Already in matchmaking queue',
          gameType: existingQueueEntry.gameType,
          maxPlayers: existingQueueEntry.maxPlayers,
          entryFee: existingQueueEntry.entryFee,
          playerName: userName,
          playerId: userId
        });
      }

      await matchmakingService.joinQueue(userId, gameType, maxPlayers, entryFee);
      socket.emit('matchmakingStatus', { 
        status: 'waiting', 
        message: 'Waiting for players...',
        gameType,
        maxPlayers,
        entryFee,
        playerName: userName,
        playerId: userId
      });
      
      logger.info(`✅ User ${userId} (${userName}) successfully joined matchmaking queue`);
    } catch (err) {
      logger.error(`❌ Matchmaking join error for user ${userId} (${userName}):`, err);
      const message = err.message === 'Insufficient balance' 
        ? 'Insufficient balance to join this game'
        : err.message === 'Already in matchmaking queue for this game'
        ? 'Already in matchmaking queue'
        : 'Failed to join matchmaking';
      socket.emit('matchmakingError', { message });
    }
  });

  socket.on('leaveMatchmaking', async () => {
    try {
      // Rate limit: max 5 requests per 10 seconds for leaving
      if (!checkRateLimit(userId, 'leaveMatchmaking', 5, 10000)) {
        logger.warn(`Rate limit exceeded for leaveMatchmaking by user ${userId}`);
        return socket.emit('matchmakingError', { 
          message: 'Too many requests. Please wait before trying again.' 
        });
      }

      logger.info(`User ${userId} leaving matchmaking queue`);
      await matchmakingService.leaveQueue(userId);
      socket.emit('matchmakingStatus', { status: 'left', message: 'Left queue' });
      logger.info(`User ${userId} successfully left matchmaking queue`);
    } catch (err) {
      logger.error(`Leave matchmaking error for user ${userId}:`, err);
      socket.emit('matchmakingError', { message: 'Failed to leave queue' });
    }
  });

  // Game events with rate limiting
  socket.on('joinGameRoom', async (data) => {
    try {
      // Rate limit: max 5 requests per 10 seconds
      if (!checkRateLimit(userId, 'joinGameRoom', 5, 10000)) {
        logger.warn(`Rate limit exceeded for joinGameRoom by user ${userId}`);
        return socket.emit('gameError', { message: 'Too many requests. Please wait.' });
      }

      const { gameId } = data || {};
      
      if (!gameId || typeof gameId !== 'string' || gameId.trim() === '') {
        logger.warn(`Invalid gameId in joinGameRoom from user ${userId}:`, gameId);
        return socket.emit('gameError', { message: 'Valid Game ID required' });
      }

      const game = await gameService.getGameById(gameId);
      if (!game) {
        logger.warn(`Game not found for gameId ${gameId} from user ${userId}`);
        return socket.emit('gameError', { message: 'Game not found' });
      }

      const isParticipant = game.participants.some(p => p.userId === userId);
      if (!isParticipant) {
        return socket.emit('gameError', { message: 'Not a participant' });
      }

      socketManager.addUserToGame(userId, gameId);
      socket.join(`game:${gameId}`);

      if (game.type === 'MEMORY') {
        try {
          await memoryGameService.joinRoom(socket, { roomId: gameId, playerId: userId, playerName: userName });
        } catch (error) {
          logger.error(`Error joining memory game room for user ${userId}:`, error);
          return socket.emit('gameError', { message: 'Failed to join memory game room' });
        }
      } else {
        return socket.emit('gameError', { message: 'Unsupported game type' });
      }

      socket.emit('gameRoomJoined', { gameId });
    } catch (error) {
      logger.error(`Error joining game room for user ${userId}:`, error);
      socket.emit('gameError', { message: 'Failed to join game' });
    }
  });

  // Game action handlers with rate limiting
  socket.on('selectCard', async (data) => {
    try {
      // Rate limit: max 10 requests per 5 seconds for card selection
      if (!checkRateLimit(userId, 'selectCard', 10, 5000)) {
        logger.warn(`Rate limit exceeded for selectCard by user ${userId}`);
        return socket.emit('gameError', { message: 'Too many card selections. Please slow down.' });
      }

      const { error, value } = gameSchemas.selectCard.validate(data);
      if (error) {
        return socket.emit('gameError', { message: error.details[0].message });
      }

      const { gameId, position } = value;
      try {
        await memoryGameService.selectCard(socket, { gameId, playerId: userId, position });
      } catch (error) {
        logger.error(`Error selecting card for user ${userId}:`, error);
        socket.emit('gameError', { message: 'Failed to select card' });
      }
    } catch (err) {
      logger.error(`Select card error for user ${userId}:`, err);
      socket.emit('gameError', { message: 'Failed to select card' });
    }
  });

  // Additional game action handlers with rate limiting
  socket.on('makeMove', async (data) => {
    try {
      // Rate limit: max 10 requests per 5 seconds
      if (!checkRateLimit(userId, 'makeMove', 10, 5000)) {
        return socket.emit('gameError', { message: 'Too many moves. Please slow down.' });
      }

      const { gameId, moveData } = data || {};
      
      if (!gameId) {
        return socket.emit('gameError', { message: 'Game ID required' });
      }

      const validation = gameStateManager.validateGameAction(gameId, userId, 'makeMove');
      if (!validation.valid) {
        return socket.emit('gameError', { message: validation.reason });
      }

      // Route to appropriate game service based on game type
      const game = await gameService.getGameById(gameId);
      if (!game) {
        return socket.emit('gameError', { message: 'Game not found' });
      }

      if (game.type === 'MEMORY') {
        await memoryGameService.makeMove(socket, { gameId, playerId: userId, moveData });
      } else {
        return socket.emit('gameError', { message: 'Unsupported game type' });
      }
    } catch (err) {
      logger.error(`Make move error for user ${userId}:`, err);
      socket.emit('gameError', { message: 'Failed to make move' });
    }
  });

  socket.on('getGameState', async (data) => {
    try {
      // Rate limit: max 5 requests per 10 seconds
      if (!checkRateLimit(userId, 'getGameState', 5, 10000)) {
        return socket.emit('gameError', { message: 'Too many requests for game state.' });
      }

      const { gameId } = data || {};
      
      if (!gameId) {
        return socket.emit('gameError', { message: 'Game ID required' });
      }

      const game = await gameService.getGameById(gameId);
      if (!game) {
        return socket.emit('gameError', { message: 'Game not found' });
      }

      const isParticipant = game.participants.some(p => p.userId === userId);
      if (!isParticipant) {
        return socket.emit('gameError', { message: 'Not a participant' });
      }

      // Get game state from appropriate service
      let gameState;
      if (game.type === 'MEMORY') {
        gameState = await memoryGameService.getGameState(gameId);
      } else {
        return socket.emit('gameError', { message: 'Unsupported game type' });
      }

      socket.emit('gameState', { gameId, state: gameState });
    } catch (err) {
      logger.error(`Get game state error for user ${userId}:`, err);
      socket.emit('gameError', { message: 'Failed to get game state' });
    }
  });

  // Chat functionality with rate limiting
  socket.on('sendChatMessage', async (data) => {
    try {
      // Rate limit: max 10 messages per 30 seconds
      if (!checkRateLimit(userId, 'sendChatMessage', 10, 30000)) {
        return socket.emit('chatError', { message: 'Too many messages. Please slow down.' });
      }

      const { gameId, message } = data || {};
      
      if (!gameId || !message || typeof message !== 'string' || message.trim().length === 0) {
        return socket.emit('chatError', { message: 'Valid game ID and message required' });
      }

      if (message.length > 500) {
        return socket.emit('chatError', { message: 'Message too long' });
      }

      const game = await gameService.getGameById(gameId);
      if (!game) {
        return socket.emit('chatError', { message: 'Game not found' });
      }

      const isParticipant = game.participants.some(p => p.userId === userId);
      if (!isParticipant) {
        return socket.emit('chatError', { message: 'Not a participant' });
      }

      const chatMessage = {
        id: Date.now().toString(),
        userId,
        userName,
        message: message.trim(),
        timestamp: new Date().toISOString()
      };

      // Broadcast to all players in the game
      io.to(`game:${gameId}`).emit('chatMessage', chatMessage);
      
      logger.info(`Chat message in game ${gameId} from user ${userId}: ${message}`);
    } catch (err) {
      logger.error(`Chat message error for user ${userId}:`, err);
      socket.emit('chatError', { message: 'Failed to send message' });
    }
  });

  // Player status updates with rate limiting
  socket.on('updatePlayerStatus', async (data) => {
    try {
      // Rate limit: max 5 requests per 10 seconds
      if (!checkRateLimit(userId, 'updatePlayerStatus', 5, 10000)) {
        return socket.emit('gameError', { message: 'Too many status updates.' });
      }

      const { gameId, status } = data || {};
      
      if (!gameId || !status) {
        return socket.emit('gameError', { message: 'Game ID and status required' });
      }

      const validStatuses = ['ready', 'not_ready', 'playing', 'paused', 'disconnected'];
      if (!validStatuses.includes(status)) {
        return socket.emit('gameError', { message: 'Invalid status' });
      }

      const game = await gameService.getGameById(gameId);
      if (!game) {
        return socket.emit('gameError', { message: 'Game not found' });
      }

      const isParticipant = game.participants.some(p => p.userId === userId);
      if (!isParticipant) {
        return socket.emit('gameError', { message: 'Not a participant' });
      }

      // Update player status in game state
      await gameStateManager.updatePlayerStatus(gameId, userId, status);

      // Broadcast status update to all players
      io.to(`game:${gameId}`).emit('playerStatusUpdate', {
        playerId: userId,
        playerName: userName,
        status,
        timestamp: new Date().toISOString()
      });

      logger.info(`Player ${userId} status updated to ${status} in game ${gameId}`);
    } catch (err) {
      logger.error(`Update player status error for user ${userId}:`, err);
      socket.emit('gameError', { message: 'Failed to update status' });
    }
  });

  // Disconnect handling
  socket.on('disconnect', (reason) => {
    logger.info(`User disconnected: ${userId} (${reason})`);
    
    try {
      socketManager.removeConnection(socket.id);

      // Clean up rate limits for this user
      const keysToDelete = [];
      for (const key of socketRateLimits.keys()) {
        if (key.startsWith(`${userId}_`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => socketRateLimits.delete(key));

      // Update player status to disconnected in active games
      const userGames = socketManager.getUserGames(userId);
      if (userGames && userGames.length > 0) {
        userGames.forEach(gameId => {
          gameStateManager.updatePlayerStatus(gameId, userId, 'disconnected').catch(err => 
            logger.error(`Error updating disconnect status for user ${userId} in game ${gameId}:`, err)
          );
          
          // Notify other players
          socket.to(`game:${gameId}`).emit('playerStatusUpdate', {
            playerId: userId,
            playerName: userName,
            status: 'disconnected',
            timestamp: new Date().toISOString()
          });
        });
      }

      // Remove from matchmaking queue if not online on other devices
      if (!socketManager.isUserOnline(userId)) {
        matchmakingService.leaveQueue(userId).catch(err => 
          logger.error(`Error removing user from queue:`, err)
        );
      }

      // Clean up memory game state if user was in a memory game
      if (memoryGameService && typeof memoryGameService.handlePlayerDisconnect === 'function') {
        memoryGameService.handlePlayerDisconnect(socket).catch(err => 
          logger.error(`Error handling memory game disconnect for user ${userId}:`, err)
        );
      }

      // Remove all socket listeners to prevent memory leaks
      socket.removeAllListeners();
      
    } catch (error) {
      logger.error(`Error during disconnect cleanup for user ${userId}:`, error);
    }
  });

  socket.on('error', (err) => {
    logger.error(`Socket error for user ${userId}:`, err);
    socket.emit('serverError', { message: 'Server error occurred' });
  });
});

// Matchmaking callback - Only Memory Game
matchmakingService.setGameCreatedCallback(async (game, matchedUsers) => {
  try {
    logger.info(`Game created: ${game.id} (${game.type}) with ${matchedUsers.length} players`);

    for (const user of matchedUsers) {
      const userSocketIds = socketManager.getUserSockets(user.id);
      
      if (userSocketIds.size > 0) {
        socketManager.addUserToGame(user.id, game.id);
        
        for (const socketId of userSocketIds) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            const participant = game.participants.find(p => p.userId === user.id);
            
            socket.emit('matchFound', {
              gameId: game.id,
              gameType: game.type,
              players: matchedUsers.map(u => ({ 
                id: u.id, 
                name: u.name || u.phoneNumber || `User${u.id.slice(-4)}`,
                phoneNumber: u.phoneNumber 
              })),
              yourPlayerId: user.id,
              yourPlayerName: user.name || user.phoneNumber || `User${user.id.slice(-4)}`,
              yourPlayerIndex: participant?.position || -1,
              yourPlayerColor: participant?.color || null,
            });
            
            logger.info(`📤 Sent matchFound to user ${user.id} (${user.name}) for game ${game.id}`);
            
            socket.join(`game:${game.id}`);
            
            // Auto-join game room - Only Memory Game
            if (game.type === 'MEMORY') {
              try {
                await memoryGameService.joinRoom(socket, { 
                  roomId: game.id, 
                  playerId: user.id, 
                  playerName: user.name 
                });
              } catch (error) {
                logger.error(`Error auto-joining memory game room for user ${user.id}:`, error);
              }
            }
          }
        }
      }
    }

    // Auto-start game after delay
    setTimeout(async () => {
      try {
        if (!game || !game.id) {
          logger.error('Auto-start failed: game or game.id is undefined', { game });
          return;
        }

        logger.info(`Auto-starting game ${game.id} of type ${game.type}`);
        const gameFromDb = await gameService.getGameById(game.id);
        
        if (gameFromDb?.status === 'WAITING') {
          // Check if players are in socket rooms
          const socketsInRoom = await io.in(`game:${game.id}`).allSockets();
          logger.info(`Game ${game.id}: ${socketsInRoom.size} sockets in room, ${gameFromDb.participants.length} participants expected`);
          
          if (game.type === 'MEMORY') {
            logger.info(`Starting Memory game ${game.id} with ${socketsInRoom.size} sockets in room`);
            try {
              await memoryGameService.startGame({ roomId: game.id });
            } catch (error) {
              logger.error(`Error starting memory game ${game.id}:`, error);
            }
          }
          logger.info(`Successfully auto-started game ${game.id}`);
        } else {
          logger.warn(`Game ${game.id} not in WAITING status: ${gameFromDb?.status}`);
        }
      } catch (error) {
        logger.error(`Error auto-starting game ${game?.id || 'unknown'}:`, error);
        logger.error(`Error stack:`, error.stack);
      }
    }, 5000); // 5 seconds delay for all games
  } catch (error) {
    logger.error('Error in matchmaking callback:', error);
  }
});

// Express middleware
app.use(cors());
app.use(helmet());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  message: "Too many requests from this IP, please try again later."
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/wallet', require('./src/routes/wallet')); // Use dedicated wallet routes
app.use('/api/matchmaking', require('./src/routes/matchmaking'));
app.use('/api/game', require('./src/routes/game'));
app.use('/api/profile', require('./src/routes/profile'));
app.use('/api/payment', require('./src/routes/payment'));
app.use('/api/feedback', require('./src/routes/feedback'));
app.use('/api/website', require('./src/routes/website')); // Website-specific routes
app.use('/api/integrity', require('./src/routes/integrity')); // Play Integrity API routes

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connections: socketManager.getStats(),
    games: gameStateManager.getStats(),
    rateLimits: {
      activeUsers: socketRateLimits.size,
      totalLimits: Array.from(socketRateLimits.values()).reduce((sum, limit) => sum + limit.count, 0)
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB'
    },
    version: process.version,
    platform: process.platform
  });
});

// Debug endpoints
app.get('/debug/queue', async (req, res) => {
  try {
    const queueEntries = await prisma.matchmakingQueue.findMany({
      include: { user: true }
    });
    
    res.json({
      success: true,
      queueCount: queueEntries.length,
      entries: queueEntries.map(entry => ({
        id: entry.id,
        userId: entry.userId,
        userName: entry.user.name,
        gameType: entry.gameType,
        maxPlayers: entry.maxPlayers,
        entryFee: entry.entryFee,
        createdAt: entry.createdAt
      }))
    });
  } catch (error) {
    logger.error('Debug queue endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve queue data'
    });
  }
});

app.get('/debug/sockets', (req, res) => {
  try {
    const connectedSockets = io.sockets.sockets;
    const socketIds = Array.from(connectedSockets.keys());
    const sockets = socketIds.map(id => {
      const socket = connectedSockets.get(id);
      return {
        id: socket.id,
        userId: socket.user?.id,
        userName: socket.user?.name,
        connectedAt: socket.handshake.time,
        address: socket.handshake.address,
      };
    });

    res.json({
      success: true,
      totalConnections: connectedSockets.size,
      sockets: sockets,
    });
  } catch (error) {
    logger.error('Debug sockets endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve socket data'
    });
  }
});

app.get('/debug/rate-limits', (req, res) => {
  try {
    const rateLimitStats = {};
    for (const [key, limit] of socketRateLimits.entries()) {
      const [userId, eventType] = key.split('_');
      if (!rateLimitStats[eventType]) {
        rateLimitStats[eventType] = { users: 0, totalRequests: 0 };
      }
      rateLimitStats[eventType].users++;
      rateLimitStats[eventType].totalRequests += limit.count;
    }

    res.json({
      success: true,
      totalActiveUsers: socketRateLimits.size,
      eventStats: rateLimitStats,
      recentLimits: Array.from(socketRateLimits.entries()).slice(0, 10).map(([key, limit]) => ({
        key,
        count: limit.count,
        resetTime: new Date(limit.resetTime).toISOString()
      }))
    });
  } catch (error) {
    logger.error('Debug rate limits endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve rate limit data'
    });
  }
});

app.get('/debug/games', (req, res) => {
  try {
    const gameStats = gameStateManager.getStats();
    res.json({
      success: true,
      gameStats: gameStats
    });
  } catch (error) {
    logger.error('Debug games endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve game data'
    });
  }
});

app.get('/debug/bots', async (req, res) => {
  try {
    const totalBots = await prisma.user.count({
      where: { isBot: true }
    });
    
    const availableBots = await botService.getAvailableBotsCount();
    
    const botsInQueue = await prisma.matchmakingQueue.count({
      where: {
        user: { isBot: true }
      }
    });
    
    const botsInGames = await prisma.gameParticipation.count({
      where: {
        user: { isBot: true },
        game: {
          status: {
            in: ['WAITING', 'PLAYING']
          }
        }
      }
    });
    
    const botTimers = matchmakingService.botDeploymentTimers.size;
    
    // Get advanced bot statistics
    const recentGameCount = await prisma.game.count({
      where: {
        status: 'FINISHED',
        finishedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        },
        participants: {
          some: {
            user: { isBot: true }
          }
        }
      }
    });
    
    res.json({
      success: true,
      botStats: {
        totalBots,
        availableBots,
        botsInQueue,
        botsInGames,
        activeTimers: botTimers,
        advancedSystem: {
          recentGamesWithBots: recentGameCount,
          performanceBalancing: 'Active',
          winRateTarget: '50%'
        }
      }
    });
  } catch (error) {
    logger.error('Debug bots endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve bot data'
    });
  }
});

// Enhanced bot debugging endpoint
app.get('/debug/bots/detailed', async (req, res) => {
  try {
    const botDebugger = require('./src/utils/botDebug');
    const debugInfo = await botDebugger.debugBotSelection();
    
    res.json({
      success: true,
      debugInfo
    });
  } catch (error) {
    logger.error('Detailed bot debug endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve detailed bot debug data'
    });
  }
});

// Bot cleanup endpoint
app.post('/debug/bots/cleanup', async (req, res) => {
  try {
    const botDebugger = require('./src/utils/botDebug');
    const cleanupResult = await botDebugger.cleanupStuckBots();
    
    res.json({
      success: true,
      message: 'Bot cleanup completed',
      cleanupResult
    });
  } catch (error) {
    logger.error('Bot cleanup endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup bots'
    });
  }
});

// Force create bots endpoint
app.post('/debug/bots/create/:count', async (req, res) => {
  try {
    const count = parseInt(req.params.count) || 5;
    const botDebugger = require('./src/utils/botDebug');
    const createdBots = await botDebugger.forceCreateBots(count);
    
    res.json({
      success: true,
      message: `Created ${createdBots.length} new bots`,
      bots: createdBots.map(bot => ({ id: bot.id, name: bot.name }))
    });
  } catch (error) {
    logger.error('Force create bots endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create bots'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Express error:', err);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 8080;

// Start server
async function startServer() {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('Database connected successfully');
    
    // Initialize services
    await matchmakingService.initialize();
    logger.info('Matchmaking service initialized');
    
    await gameStateManager.initialize();
    logger.info('Game state manager initialized');
    
    // Ensure minimum bots are available
    await botService.ensureMinimumBots(10);
    logger.info('Bot service initialized with minimum bots');
    
    // Initialize advanced bot performance tracking
    logger.info('Advanced bot system initialized with 50% win rate balancing');
    
    // Start HTTP server
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Rate limiting enabled for socket events`);
    });
    
    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
      } else {
        logger.error('Server error:', error);
      }
      process.exit(1);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  
  try {
    // Stop accepting new connections
    server.close(async () => {
      logger.info('HTTP server closed');
      
      // Disconnect all socket connections
      io.close(() => {
        logger.info('Socket.IO server closed');
      });
      
      // Stop services
      if (matchmakingService.stop) {
        await matchmakingService.stop();
        logger.info('Matchmaking service stopped');
      }
      
      if (gameStateManager.stop) {
        await gameStateManager.stop();
        logger.info('Game state manager stopped');
      }
      
      // Close database connection
      await prisma.$disconnect();
      logger.info('Database disconnected');
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
    
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

// Process signal handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Don't exit the process for unhandled rejections in production
  // Instead, log the error and continue running
  if (process.env.NODE_ENV === 'production') {
    logger.error('Continuing execution despite unhandled rejection...');
  } else {
    // In development, still exit to catch issues early
    process.exit(1);
  }
});

// Memory monitoring
setInterval(() => {
  const memUsage = process.memoryUsage();
  const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  
  if (memUsedMB > 1000) { // Alert if memory usage exceeds 1GB
    logger.warn(`High memory usage: ${memUsedMB}MB`);
  }
}, 60000); // Check every minute

// Cleanup intervals
setInterval(() => {
  try {
    socketManager.cleanup();
    gameStateManager.cleanup();
    logger.debug('Cleanup completed');
  } catch (error) {
    logger.error('Cleanup error:', error);
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Bot maintenance intervals
setInterval(() => {
  try {
    botService.cleanupInactiveBots();
    botService.ensureMinimumBots(10);
    logger.debug('Bot maintenance completed');
  } catch (error) {
    logger.error('Bot maintenance error:', error);
  }
}, 2 * 60 * 1000); // Every 2 minutes

// Start the server
startServer();

module.exports = { app, server, io };