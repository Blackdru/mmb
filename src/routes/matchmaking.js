const express = require('express');
const router = express.Router();
const matchmakingService = require('../services/matchmakingService');
const { gameSchemas } = require('../validation/schemas');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../config/logger');

// Join matchmaking queue
router.post('/join', authenticateToken, async (req, res) => {
  try {
    const { error, value } = gameSchemas.joinMatchmaking.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }
    const { gameType, maxPlayers, entryFee } = value;
    const result = await matchmakingService.joinQueue(req.user.id, gameType, maxPlayers, entryFee);
    res.json(result);
  } catch (err) {
    logger.error('Join matchmaking queue error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Leave matchmaking queue
router.post('/leave', authenticateToken, async (req, res) => {
  try {
    const result = await matchmakingService.leaveQueue(req.user.id);
    res.json(result);
  } catch (err) {
    logger.error('Leave matchmaking queue error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Get queue status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const result = await matchmakingService.getQueueStatus(req.user.id);
    res.json(result);
  } catch (err) {
    logger.error('Get queue status error:', err);
    res.status(500).json({ success: false, message: 'Failed to get queue status' });
  }
});

// Manual bot deployment for testing (development only)
router.post('/deploy-bot', authenticateToken, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Not available in production' });
    }

    const { gameType = 'MEMORY', maxPlayers = 2, entryFee = 5, force = false } = req.body;
    
    if (force) {
      // Force deploy a bot regardless of queue status
      const botService = require('../services/botService');
      const botUser = await botService.getBotForMatchmaking(gameType, entryFee);
      logger.info(`🤖 Force deployed bot ${botUser.name} (${botUser.id}) for testing`);
      
      // Trigger immediate matchmaking
      setTimeout(() => matchmakingService.processMatchmaking(), 500);
      
      res.json({ 
        success: true, 
        message: `Bot ${botUser.name} force deployed for ${gameType} ${maxPlayers}P ₹${entryFee}`,
        botId: botUser.id,
        botName: botUser.name
      });
    } else {
      // Normal bot deployment logic
      await matchmakingService.deployBotIfNeeded(gameType, maxPlayers, entryFee);
      
      res.json({ 
        success: true, 
        message: `Bot deployment triggered for ${gameType} ${maxPlayers}P ₹${entryFee}` 
      });
    }
  } catch (err) {
    logger.error('Manual bot deployment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
