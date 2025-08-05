const prisma = require('../config/database');
const firebaseService = require('../config/firebase');
const logger = require('../config/logger');

class PushNotificationService {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    try {
      this.initialized = firebaseService.initialize();
      if (this.initialized) {
        logger.info('Push Notification Service initialized');
      }
      return this.initialized;
    } catch (error) {
      logger.error('Failed to initialize Push Notification Service:', error);
      return false;
    }
  }

  async registerDeviceToken(userId, token, platform = 'android') {
    try {
      // Check if token already exists
      const existingToken = await prisma.pushNotificationToken.findUnique({
        where: { token }
      });

      if (existingToken) {
        // Update existing token
        await prisma.pushNotificationToken.update({
          where: { token },
          data: {
            userId,
            platform,
            isActive: true,
            updatedAt: new Date()
          }
        });
      } else {
        // Create new token
        await prisma.pushNotificationToken.create({
          data: {
            userId,
            token,
            platform,
            isActive: true
          }
        });
      }

      logger.info(`Device token registered for user ${userId}`);
      return { success: true };
    } catch (error) {
      logger.error('Failed to register device token:', error);
      throw error;
    }
  }

  async unregisterDeviceToken(token) {
    try {
      await prisma.pushNotificationToken.updateMany({
        where: { token },
        data: { isActive: false }
      });

      logger.info(`Device token unregistered: ${token}`);
      return { success: true };
    } catch (error) {
      logger.error('Failed to unregister device token:', error);
      throw error;
    }
  }

  async sendNotification(notificationData) {
    if (!this.initialized) {
      throw new Error('Push notification service not initialized');
    }

    try {
      // Create notification record
      const notification = await prisma.pushNotification.create({
        data: {
          title: notificationData.title,
          body: notificationData.body,
          data: notificationData.data || {},
          type: notificationData.type || 'GENERAL',
          targetType: notificationData.targetType || 'ALL_USERS',
          targetUsers: notificationData.targetUsers || [],
          senderId: notificationData.senderId,
          senderType: notificationData.senderType || 'admin',
          scheduledAt: notificationData.scheduledAt || new Date(),
          status: 'SENDING'
        }
      });

      // Get target users and their tokens
      const targetUsers = await this.getTargetUsers(notificationData);
      const tokens = await this.getUserTokens(targetUsers);

      if (tokens.length === 0) {
        await prisma.pushNotification.update({
          where: { id: notification.id },
          data: {
            status: 'FAILED',
            totalTargets: 0,
            failureCount: 1
          }
        });
        throw new Error('No valid device tokens found');
      }

      // Send notification via Firebase
      const result = await firebaseService.sendNotification(tokens, {
        title: notificationData.title,
        body: notificationData.body,
        data: notificationData.data || {}
      });

      // Update notification status
      await prisma.pushNotification.update({
        where: { id: notification.id },
        data: {
          status: 'SENT',
          totalTargets: tokens.length,
          successCount: result.successCount,
          failureCount: result.failureCount,
          sentAt: new Date()
        }
      });

      // Create recipient records
      await this.createRecipientRecords(notification.id, targetUsers, result.responses);

      logger.info(`Notification sent: ${result.successCount} success, ${result.failureCount} failed`);
      
      return {
        success: true,
        notificationId: notification.id,
        ...result
      };
    } catch (error) {
      logger.error('Failed to send notification:', error);
      throw error;
    }
  }

  async getTargetUsers(notificationData) {
    const { targetType, targetUsers } = notificationData;

    switch (targetType) {
      case 'ALL_USERS':
        return await prisma.user.findMany({
          where: { isBot: false },
          select: { id: true }
        });

      case 'ACTIVE_USERS':
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return await prisma.user.findMany({
          where: {
            isBot: false,
            updatedAt: { gte: oneWeekAgo }
          },
          select: { id: true }
        });

      case 'SPECIFIC_USERS':
        return await prisma.user.findMany({
          where: {
            id: { in: targetUsers },
            isBot: false
          },
          select: { id: true }
        });

      case 'NEW_USERS':
        const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        return await prisma.user.findMany({
          where: {
            isBot: false,
            createdAt: { gte: oneMonthAgo }
          },
          select: { id: true }
        });

      case 'HIGH_VALUE_USERS':
        return await prisma.user.findMany({
          where: {
            isBot: false,
            wallet: {
              balance: { gte: 100 }
            }
          },
          select: { id: true }
        });

      default:
        return [];
    }
  }

  async getUserTokens(users) {
    const userIds = users.map(user => user.id);
    
    const tokens = await prisma.pushNotificationToken.findMany({
      where: {
        userId: { in: userIds },
        isActive: true
      },
      select: { token: true }
    });

    return tokens.map(t => t.token);
  }

  async createRecipientRecords(notificationId, users, responses) {
    const recipients = users.map((user, index) => ({
      notificationId,
      userId: user.id,
      status: responses && responses[index] && responses[index].success ? 'DELIVERED' : 'FAILED',
      deliveredAt: responses && responses[index] && responses[index].success ? new Date() : null,
      errorMessage: responses && responses[index] && !responses[index].success ? 
        responses[index].error?.message : null
    }));

    await prisma.pushNotificationRecipient.createMany({
      data: recipients
    });
  }

  async getNotificationHistory(page = 1, limit = 20, filters = {}) {
    const skip = (page - 1) * limit;
    
    const where = {};
    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status;
    if (filters.targetType) where.targetType = filters.targetType;

    const [notifications, total] = await Promise.all([
      prisma.pushNotification.findMany({
        where,
        include: {
          sender: {
            select: { id: true, name: true, phoneNumber: true }
          },
          _count: {
            select: { recipients: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.pushNotification.count({ where })
    ]);

    return {
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  async getNotificationStats() {
    const [total, sent, pending, failed] = await Promise.all([
      prisma.pushNotification.count(),
      prisma.pushNotification.count({ where: { status: 'SENT' } }),
      prisma.pushNotification.count({ where: { status: 'PENDING' } }),
      prisma.pushNotification.count({ where: { status: 'FAILED' } })
    ]);

    const activeTokens = await prisma.pushNotificationToken.count({
      where: { isActive: true }
    });

    return {
      totalNotifications: total,
      sentNotifications: sent,
      pendingNotifications: pending,
      failedNotifications: failed,
      activeDevices: activeTokens
    };
  }

  // Game-specific notifications
  async sendGameInvite(fromUserId, toUserId, gameData) {
    const fromUser = await prisma.user.findUnique({
      where: { id: fromUserId },
      select: { name: true, phoneNumber: true }
    });

    const userName = fromUser?.name || fromUser?.phoneNumber || 'Someone';

    return await this.sendNotification({
      title: 'Game Invitation',
      body: `${userName} invited you to play ${gameData.gameType}!`,
      type: 'GAME_INVITE',
      targetType: 'SPECIFIC_USERS',
      targetUsers: [toUserId],
      data: {
        type: 'game_invite',
        gameId: gameData.gameId,
        fromUserId,
        gameType: gameData.gameType
      },
      senderId: fromUserId,
      senderType: 'user'
    });
  }

  async sendGameResult(userId, gameResult) {
    const title = gameResult.won ? '🎉 You Won!' : '😔 Game Over';
    const body = gameResult.won ? 
      `Congratulations! You won ₹${gameResult.winnings}` :
      `Better luck next time! Keep playing to win big.`;

    return await this.sendNotification({
      title,
      body,
      type: 'GAME_RESULT',
      targetType: 'SPECIFIC_USERS',
      targetUsers: [userId],
      data: {
        type: 'game_result',
        gameId: gameResult.gameId,
        won: gameResult.won,
        winnings: gameResult.winnings?.toString()
      },
      senderType: 'system'
    });
  }

  async sendWalletUpdate(userId, transaction) {
    const isCredit = transaction.amount > 0;
    const title = isCredit ? '💰 Money Added' : '💸 Money Deducted';
    const body = `₹${Math.abs(transaction.amount)} ${isCredit ? 'added to' : 'deducted from'} your wallet`;

    return await this.sendNotification({
      title,
      body,
      type: 'WALLET_UPDATE',
      targetType: 'SPECIFIC_USERS',
      targetUsers: [userId],
      data: {
        type: 'wallet_update',
        transactionId: transaction.id,
        amount: transaction.amount.toString(),
        transactionType: transaction.type
      },
      senderType: 'system'
    });
  }
}

const pushNotificationService = new PushNotificationService();
module.exports = pushNotificationService;