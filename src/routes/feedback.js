const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const prisma = require('../config/database');
const logger = require('../config/logger');
const Joi = require('joi');

// Validation schemas
const appFeedbackSchema = Joi.object({
  message: Joi.string().min(10).max(1000).required(),
  type: Joi.string().valid('GENERAL', 'BUG_REPORT', 'FEATURE_REQUEST', 'COMPLAINT', 'SUGGESTION').default('GENERAL')
});

const websiteFeedbackSchema = Joi.object({
  feedback: Joi.string().min(10).max(500).required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  category: Joi.string().valid('gameplay', 'ui', 'performance', 'suggestion').required(),
  app: Joi.string().default('budzee'),
  timestamp: Joi.string().isoDate().optional(),
  // Optional fields for anonymous feedback
  email: Joi.string().email().optional(),
  name: Joi.string().min(2).max(100).optional()
});

// Unified feedback endpoint - works for both app and website
router.post('/submit', async (req, res) => {
  try {
    logger.info('Feedback submission received:', req.body);
    
    // Check if this is a website feedback (has rating and category) or app feedback
    const isWebsiteFeedback = req.body.rating && req.body.category;
    
    if (isWebsiteFeedback) {
      // Website feedback - no authentication required
      const { error, value } = websiteFeedbackSchema.validate(req.body);
      if (error) {
        logger.warn('Website feedback validation error:', error.details[0].message);
        return res.status(400).json({
          success: false,
          message: error.details[0].message
        });
      }

      const { feedback, rating, category, app, email, name } = value;

      // Create website feedback record
      const feedbackRecord = await prisma.websiteFeedback.create({
        data: {
          message: feedback.trim(),
          rating: rating,
          category: category.toUpperCase(),
          app: app.toLowerCase(),
          status: 'PENDING',
          source: 'WEBSITE',
          // Store optional contact info in response field as JSON
          response: email || name ? JSON.stringify({ email, name }) : null
        }
      });

      logger.info(`Website feedback submitted: ${feedbackRecord.id} with rating ${rating}`);

      res.json({
        success: true,
        message: 'Thank you for your feedback! Your input helps us improve Budzee.',
        feedbackId: feedbackRecord.id
      });

    } else {
      // App feedback - requires authentication
      if (!req.headers.authorization) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required for app feedback'
        });
      }

      // Authenticate the user
      try {
        await authenticateToken(req, res, () => {});
      } catch (authError) {
        return res.status(401).json({
          success: false,
          message: 'Invalid authentication token'
        });
      }

      const { error, value } = appFeedbackSchema.validate(req.body);
      if (error) {
        logger.warn('App feedback validation error:', error.details[0].message);
        return res.status(400).json({
          success: false,
          message: error.details[0].message
        });
      }

      const { message, type } = value;

      // Create app feedback record
      const feedback = await prisma.feedback.create({
        data: {
          userId: req.user.id,
          message: message.trim(),
          type: type.toUpperCase(),
          status: 'PENDING'
        }
      });

      logger.info(`App feedback submitted by user ${req.user.id}: ${feedback.id}`);

      res.json({
        success: true,
        message: 'Feedback submitted successfully',
        feedbackId: feedback.id
      });
    }

  } catch (error) {
    logger.error('Feedback submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit feedback. Please try again later.'
    });
  }
});

// Get feedback for authenticated users (app only)
router.get('/my-feedback', authenticateToken, async (req, res) => {
  try {
    const feedback = await prisma.feedback.findMany({
      where: {
        userId: req.user.id
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 20 // Limit to last 20 feedback items
    });

    res.json({
      success: true,
      feedback: feedback
    });
  } catch (error) {
    logger.error('Get feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve feedback'
    });
  }
});

module.exports = router;