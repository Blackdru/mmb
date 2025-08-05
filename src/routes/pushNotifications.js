const express = require('express');
const router = express.Router();
const pushNotificationService = require('../services/pushNotificationService');
const { authenticateToken } = require('../middleware/auth');
const adminAuth = require('../routes/admin-auth');

// Extract admin auth middleware
const authenticateAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'budzee-admin-secret-key-2025';
    const decoded = jwt.verify(token, JWT_SECRET);
    
    req.admin = { id: decoded.id, username: decoded.username, role: decoded.role };
    next();
  } catch (error) {
    logger.error('Admin auth error:', error);
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};
const logger = require('../config/logger');

// User routes - Register/unregister device tokens
router.post('/register-token', authenticateToken, async (req, res) => {
  try {
    const { token, platform = 'android' } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }

    const result = await pushNotificationService.registerDeviceToken(
      req.user.id,
      token,
      platform
    );

    res.json({
      success: true,
      message: 'Device token registered successfully'
    });
  } catch (error) {
    logger.error('Register token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register device token'
    });
  }
});

router.post('/unregister-token', authenticateToken, async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }

    await pushNotificationService.unregisterDeviceToken(token);

    res.json({
      success: true,
      message: 'Device token unregistered successfully'
    });
  } catch (error) {
    logger.error('Unregister token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unregister device token'
    });
  }
});

// Admin routes - Send and manage notifications
router.post('/send', authenticateAdmin, async (req, res) => {
  try {
    const {
      title,
      body,
      type = 'GENERAL',
      targetType = 'ALL_USERS',
      targetUsers = [],
      data = {},
      scheduledAt
    } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: 'Title and body are required'
      });
    }

    const result = await pushNotificationService.sendNotification({
      title,
      body,
      type,
      targetType,
      targetUsers,
      data,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      senderId: req.admin.id,
      senderType: 'admin'
    });

    res.json({
      success: true,
      message: 'Notification sent successfully',
      data: result
    });
  } catch (error) {
    logger.error('Send notification error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send notification'
    });
  }
});

router.get('/history', authenticateAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      type,
      status,
      targetType
    } = req.query;

    const filters = {};
    if (type) filters.type = type;
    if (status) filters.status = status;
    if (targetType) filters.targetType = targetType;

    const result = await pushNotificationService.getNotificationHistory(
      parseInt(page),
      parseInt(limit),
      filters
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Get notification history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notification history'
    });
  }
});

router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const stats = await pushNotificationService.getNotificationStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Get notification stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notification stats'
    });
  }
});

// Test notification endpoint
router.post('/test', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required for test notification'
      });
    }

    const result = await pushNotificationService.sendNotification({
      title: 'Test Notification',
      body: 'This is a test notification from Budzee admin panel',
      type: 'GENERAL',
      targetType: 'SPECIFIC_USERS',
      targetUsers: [userId],
      data: { test: true },
      senderId: req.admin.id,
      senderType: 'admin'
    });

    res.json({
      success: true,
      message: 'Test notification sent successfully',
      data: result
    });
  } catch (error) {
    logger.error('Send test notification error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send test notification'
    });
  }
});

module.exports = router;