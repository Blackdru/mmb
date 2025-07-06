const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const prisma = require('../config/database');
const logger = require('../config/logger');

// Submit feedback
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const { message, type = 'GENERAL' } = req.body;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Feedback message is required'
      });
    }

    if (message.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Feedback message too long (max 1000 characters)'
      });
    }

    const feedback = await prisma.feedback.create({
      data: {
        userId: req.user.id,
        message: message.trim(),
        type: type.toUpperCase(),
        status: 'PENDING'
      }
    });

    logger.info(`Feedback submitted by user ${req.user.id}: ${feedback.id}`);

    res.json({
      success: true,
      message: 'Feedback submitted successfully',
      feedbackId: feedback.id
    });
  } catch (error) {
    logger.error('Submit feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit feedback'
    });
  }
});

module.exports = router;