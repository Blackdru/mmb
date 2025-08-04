const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const logger = require('../config/logger');
const Joi = require('joi');

// Validation schemas
const contactSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  issue: Joi.string().valid('technical', 'gameplay', 'account', 'feedback', 'bug', 'partnership', 'other').required(),
  description: Joi.string().min(10).max(1000).required(),
  app: Joi.string().default('budzee'),
  timestamp: Joi.string().isoDate().optional()
});

// Feedback schema moved to unified feedback route

// Contact form submission
router.post('/contact', async (req, res) => {
  try {
    logger.info('Contact form submission received:', req.body);
    
    const { error, value } = contactSchema.validate(req.body);
    if (error) {
      logger.warn('Contact form validation error:', error.details[0].message);
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { name, email, issue, description, app } = value;

    // Create contact submission in database
    const contact = await prisma.contactSubmission.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        issueType: issue.toUpperCase(),
        description: description.trim(),
        app: app.toLowerCase(),
        status: 'PENDING',
        source: 'WEBSITE'
      }
    });

    logger.info(`Website contact form submitted: ${contact.id} from ${email}`);

    // You can add email notification logic here
    // await sendContactNotification(contact);

    res.json({
      success: true,
      message: 'Your message has been sent successfully! We\'ll get back to you within 24 hours.',
      contactId: contact.id
    });
  } catch (error) {
    logger.error('Website contact form error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message. Please try again later.'
    });
  }
});

// Feedback endpoint removed - now handled by unified /api/feedback/submit endpoint

// Get app statistics for website display
router.get('/stats', async (req, res) => {
  try {
    // Get various statistics
    const [
      totalUsers,
      totalGames,
      totalFeedback,
      averageRating,
      recentGames
    ] = await Promise.all([
      prisma.user.count({
        where: { isBot: false }
      }),
      prisma.game.count({
        where: { status: 'FINISHED' }
      }),
      prisma.websiteFeedback.count(),
      prisma.websiteFeedback.aggregate({
        _avg: { rating: true }
      }),
      prisma.game.count({
        where: {
          status: 'FINISHED',
          finishedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
          }
        }
      })
    ]);

    res.json({
      success: true,
      stats: {
        totalUsers: totalUsers || 0,
        totalGames: totalGames || 0,
        totalFeedback: totalFeedback || 0,
        averageRating: averageRating._avg?.rating ? Number(averageRating._avg.rating.toFixed(1)) : 4.9,
        recentGames: recentGames || 0,
        // Static stats for display
        downloads: '50K+',
        activeUsers: Math.floor(totalUsers * 0.3) || 150, // Estimate 30% active
        satisfaction: '95%'
      }
    });
  } catch (error) {
    logger.error('Website stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve statistics'
    });
  }
});

// Get app information
router.get('/app-info', async (req, res) => {
  try {
    res.json({
      success: true,
      appInfo: {
        name: 'Budzee',
        version: '1.0.0',
        description: 'Ultimate Memory Game Challenge - Train your brain with engaging multiplayer memory games',
        features: [
          'Multiplayer Memory Games',
          'Real-time Competitions',
          'Brain Training Exercises',
          'Achievement System',
          'Social Gaming',
          'Cognitive Improvement'
        ],
        requirements: {
          android: '6.0+',
          size: '~25MB',
          internet: 'Required for multiplayer'
        },
        support: {
          email: 'support@budzee.com',
          phone: '+1 (555) 123-4567',
          hours: 'Mon-Fri, 9AM-6PM EST'
        }
      }
    });
  } catch (error) {
    logger.error('App info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve app information'
    });
  }
});

// Newsletter subscription
router.post('/newsletter', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        message: 'Valid email address is required'
      });
    }

    // Check if email already exists
    const existing = await prisma.newsletterSubscription.findUnique({
      where: { email: email.toLowerCase().trim() }
    });

    if (existing) {
      return res.json({
        success: true,
        message: 'You\'re already subscribed to our newsletter!'
      });
    }

    // Create subscription
    const subscription = await prisma.newsletterSubscription.create({
      data: {
        email: email.toLowerCase().trim(),
        source: 'WEBSITE',
        status: 'ACTIVE'
      }
    });

    logger.info(`Newsletter subscription: ${subscription.email}`);

    res.json({
      success: true,
      message: 'Successfully subscribed to our newsletter!'
    });
  } catch (error) {
    logger.error('Newsletter subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to subscribe. Please try again later.'
    });
  }
});

// Download tracking
router.post('/download-track', async (req, res) => {
  try {
    const { source = 'website', userAgent, ip } = req.body;

    // Track download
    await prisma.downloadTracking.create({
      data: {
        source: source.toLowerCase(),
        userAgent: userAgent || req.get('User-Agent') || 'unknown',
        ipAddress: ip || req.ip || 'unknown',
        timestamp: new Date()
      }
    });

    logger.info(`APK download tracked from ${source}`);

    res.json({
      success: true,
      message: 'Download tracked successfully'
    });
  } catch (error) {
    logger.error('Download tracking error:', error);
    // Don't fail the download if tracking fails
    res.json({
      success: true,
      message: 'Download initiated'
    });
  }
});

module.exports = router;