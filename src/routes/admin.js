const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const logger = require('../config/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'budzee-admin-secret-key-2025';

// Admin authentication middleware
const adminAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    
    req.admin = { username: decoded.username, role: decoded.role };
    next();
  } catch (error) {
    logger.error('Admin auth error:', error);
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// Dashboard stats
router.get('/dashboard/stats', adminAuth, async (req, res) => {
  try {
    const [
      totalUsers,
      totalGames,
      totalTransactions,
      totalBots,
      activeGames,
      pendingWithdrawals,
      todayRevenue,
      todayUsers
    ] = await Promise.all([
      prisma.user.count({ where: { isBot: false } }),
      prisma.game.count(),
      prisma.transaction.count(),
      prisma.user.count({ where: { isBot: true } }),
      prisma.game.count({ where: { status: { in: ['WAITING', 'PLAYING'] } } }),
      prisma.withdrawalRequest.count({ where: { status: 'PENDING' } }),
      prisma.transaction.aggregate({
        where: {
          type: 'DEPOSIT',
          status: 'COMPLETED',
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        },
        _sum: { amount: true }
      }),
      prisma.user.count({
        where: {
          isBot: false,
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        }
      })
    ]);

    const totalRevenue = await prisma.transaction.aggregate({
      where: { type: 'DEPOSIT', status: 'COMPLETED' },
      _sum: { amount: true }
    });

    const totalWithdrawals = await prisma.transaction.aggregate({
      where: { type: 'WITHDRAWAL', status: 'COMPLETED' },
      _sum: { amount: true }
    });

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalGames,
        totalTransactions,
        totalBots,
        activeGames,
        pendingWithdrawals,
        totalRevenue: totalRevenue._sum.amount || 0,
        totalWithdrawals: totalWithdrawals._sum.amount || 0,
        todayRevenue: todayRevenue._sum.amount || 0,
        todayUsers
      }
    });
  } catch (error) {
    logger.error('Dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
  }
});

// Recent activity
router.get('/dashboard/activity', adminAuth, async (req, res) => {
  try {
    const [recentUsers, recentGames, recentTransactions] = await Promise.all([
      prisma.user.findMany({
        where: { isBot: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, phoneNumber: true, createdAt: true }
      }),
      prisma.game.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, type: true, status: true, entryFee: true, createdAt: true }
      }),
      prisma.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { user: { select: { name: true, phoneNumber: true } } }
      })
    ]);

    const activities = [
      ...recentUsers.map(user => ({
        type: 'user',
        icon: 'fas fa-user-plus',
        title: `New user: ${user.name || user.phoneNumber}`,
        time: user.createdAt,
        color: '#667eea'
      })),
      ...recentGames.map(game => ({
        type: 'game',
        icon: 'fas fa-gamepad',
        title: `${game.type} game ${game.status.toLowerCase()}`,
        time: game.createdAt,
        color: '#f093fb'
      })),
      ...recentTransactions.map(tx => ({
        type: 'transaction',
        icon: 'fas fa-credit-card',
        title: `${tx.type}: ₹${tx.amount} by ${tx.user.name || tx.user.phoneNumber}`,
        time: tx.createdAt,
        color: '#4facfe'
      }))
    ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 10);

    res.json({ success: true, activities });
  } catch (error) {
    logger.error('Dashboard activity error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch recent activity' });
  }
});

// Users management
router.get('/users', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const skip = (page - 1) * limit;

    const where = { isBot: false };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (status) {
      where.isVerified = status === 'verified';
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          wallet: true,
          _count: {
            select: {
              gameParticipations: true,
              transactions: true,
              withdrawalRequests: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    // Get detailed statistics for each user
    const usersWithStats = await Promise.all(users.map(async (user) => {
      const [
        gamesWon,
        gamesLost,
        totalWinnings,
        totalLosses,
        totalDeposits,
        totalWithdrawals,
        referralCount,
        referredByUser
      ] = await Promise.all([
        prisma.gameParticipation.count({
          where: { userId: user.id, rank: 1 }
        }),
        prisma.gameParticipation.count({
          where: { userId: user.id, rank: { not: 1 } }
        }),
        prisma.transaction.aggregate({
          where: { userId: user.id, type: 'GAME_WINNING', status: 'COMPLETED' },
          _sum: { amount: true }
        }),
        prisma.transaction.aggregate({
          where: { userId: user.id, type: 'GAME_ENTRY' },
          _sum: { amount: true }
        }),
        prisma.transaction.aggregate({
          where: { userId: user.id, type: 'DEPOSIT', status: 'COMPLETED' },
          _sum: { amount: true }
        }),
        prisma.transaction.aggregate({
          where: { userId: user.id, type: 'WITHDRAWAL', status: 'COMPLETED' },
          _sum: { amount: true }
        }),
        prisma.user.count({
          where: { referredBy: user.referralCode }
        }),
        user.referredBy ? prisma.user.findFirst({
          where: { referralCode: user.referredBy },
          select: { name: true, phoneNumber: true }
        }) : null
      ]);

      return {
        id: user.id,
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        isVerified: user.isVerified,
        balance: user.wallet?.balance || 0,
        gameBalance: user.wallet?.gameBalance || 0,
        withdrawableBalance: user.wallet?.withdrawableBalance || 0,
        gamesPlayed: user._count.gameParticipations,
        gamesWon,
        gamesLost,
        winRate: user._count.gameParticipations > 0 ? ((gamesWon / user._count.gameParticipations) * 100).toFixed(2) : 0,
        totalWinnings: totalWinnings._sum.amount || 0,
        totalLosses: totalLosses._sum.amount || 0,
        totalDeposits: totalDeposits._sum.amount || 0,
        totalWithdrawals: totalWithdrawals._sum.amount || 0,
        totalTransactions: user._count.transactions,
        totalWithdrawalRequests: user._count.withdrawalRequests,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        referredByUser,
        referralCount,
        createdAt: user.createdAt,
        lastActive: user.updatedAt,
        profitLoss: (totalWinnings._sum.amount || 0) - (totalLosses._sum.amount || 0)
      };
    }));

    res.json({
      success: true,
      users: usersWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Users fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// User details
router.get('/users/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        wallet: true,
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 20
        },
        gameParticipations: {
          include: {
            game: {
              select: {
                id: true,
                type: true,
                entryFee: true,
                status: true,
                createdAt: true,
                finishedAt: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 20
        },
        withdrawalRequests: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Calculate user statistics
    const gamesWon = await prisma.gameParticipation.count({
      where: { userId: id, rank: 1 }
    });

    const gamesLost = await prisma.gameParticipation.count({
      where: { userId: id, rank: { not: 1 } }
    });

    const totalWinnings = await prisma.transaction.aggregate({
      where: { userId: id, type: 'GAME_WINNING' },
      _sum: { amount: true }
    });

    const totalDeposits = await prisma.transaction.aggregate({
      where: { userId: id, type: 'DEPOSIT', status: 'COMPLETED' },
      _sum: { amount: true }
    });

    res.json({
      success: true,
      user: {
        ...user,
        statistics: {
          gamesWon,
          gamesLost,
          totalGames: user.gameParticipations.length,
          winRate: user.gameParticipations.length > 0 ? (gamesWon / user.gameParticipations.length * 100).toFixed(2) : 0,
          totalWinnings: totalWinnings._sum.amount || 0,
          totalDeposits: totalDeposits._sum.amount || 0
        }
      }
    });
  } catch (error) {
    logger.error('User details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user details' });
  }
});

// Update user
router.put('/users/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, isVerified, balance } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (isVerified !== undefined) updateData.isVerified = isVerified;

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      include: { wallet: true }
    });

    // Update wallet balance if provided
    if (balance !== undefined && user.wallet) {
      await prisma.wallet.update({
        where: { userId: id },
        data: { balance: parseFloat(balance) }
      });
    }

    res.json({ success: true, message: 'User updated successfully', user });
  } catch (error) {
    logger.error('User update error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user' });
  }
});

// Suspend/Unsuspend user
router.post('/users/:id/suspend', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { suspend, reason } = req.body;

    // In a real implementation, you'd have a suspended field in the user model
    // For now, we'll use isVerified as a proxy
    await prisma.user.update({
      where: { id },
      data: { isVerified: !suspend }
    });

    res.json({ 
      success: true, 
      message: suspend ? 'User suspended successfully' : 'User unsuspended successfully' 
    });
  } catch (error) {
    logger.error('User suspend error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user status' });
  }
});

// Games management
router.get('/games', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;

    const [games, total] = await Promise.all([
      prisma.game.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          participants: {
            include: {
              user: {
                select: { id: true, name: true, phoneNumber: true, isBot: true }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.game.count({ where })
    ]);

    res.json({
      success: true,
      games: games.map(game => ({
        ...game,
        participantCount: game.participants.length,
        botCount: game.participants.filter(p => p.user.isBot).length,
        humanCount: game.participants.filter(p => !p.user.isBot).length
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Games fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch games' });
  }
});

// Game details
router.get('/games/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const game = await prisma.game.findUnique({
      where: { id },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, name: true, phoneNumber: true, isBot: true }
            }
          }
        }
      }
    });

    if (!game) {
      return res.status(404).json({ success: false, message: 'Game not found' });
    }

    res.json({ success: true, game });
  } catch (error) {
    logger.error('Game details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch game details' });
  }
});

// Cancel game
router.post('/games/:id/cancel', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const game = await prisma.game.findUnique({
      where: { id },
      include: { participants: true }
    });

    if (!game) {
      return res.status(404).json({ success: false, message: 'Game not found' });
    }

    if (game.status === 'FINISHED' || game.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Game already finished or cancelled' });
    }

    // Update game status
    await prisma.game.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });

    // Refund entry fees to participants
    for (const participant of game.participants) {
      if (!participant.user?.isBot) {
        await prisma.transaction.create({
          data: {
            userId: participant.userId,
            type: 'REFUND',
            amount: game.entryFee,
            status: 'COMPLETED',
            description: `Refund for cancelled game ${id}`,
            gameId: id
          }
        });

        // Update wallet
        await prisma.wallet.update({
          where: { userId: participant.userId },
          data: {
            gameBalance: { increment: game.entryFee }
          }
        });
      }
    }

    res.json({ success: true, message: 'Game cancelled and refunds processed' });
  } catch (error) {
    logger.error('Game cancel error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel game' });
  }
});

// Transactions management
router.get('/transactions', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status, userId } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (userId) where.userId = userId;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          user: {
            select: { id: true, name: true, phoneNumber: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.transaction.count({ where })
    ]);

    res.json({
      success: true,
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Transactions fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
  }
});

// Update transaction status
router.put('/transactions/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const updated = await prisma.transaction.update({
      where: { id },
      data: { 
        status,
        description: notes ? `${existing.description ? existing.description + ' | ' : ''}Admin note: ${notes}` : undefined
      }
    });

    res.json({ success: true, message: 'Transaction updated successfully', transaction: updated });
  } catch (error) {
    logger.error('Transaction update error:', error);
    res.status(500).json({ success: false, message: 'Failed to update transaction' });
  }
});

// Withdrawals management
router.get('/withdrawals', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;

    const [withdrawals, total] = await Promise.all([
      prisma.withdrawalRequest.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          user: {
            select: { id: true, name: true, phoneNumber: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.withdrawalRequest.count({ where })
    ]);

    res.json({
      success: true,
      withdrawals,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Withdrawals fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch withdrawals' });
  }
});

// Process withdrawal
router.post('/withdrawals/:id/process', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, notes, transactionId } = req.body; // action: 'approve', 'reject', 'complete'

    const withdrawal = await prisma.withdrawalRequest.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
    }

    let updateData = {
      processedAt: new Date(),
      processedBy: 'admin', // In production, use actual admin ID
      adminNotes: notes
    };

    if (action === 'approve') {
      updateData.status = 'APPROVED';
    } else if (action === 'reject') {
      updateData.status = 'REJECTED';
      updateData.rejectionReason = notes;
      
      // Refund amount to user's withdrawable balance
      await prisma.wallet.update({
        where: { userId: withdrawal.userId },
        data: {
          withdrawableBalance: { increment: withdrawal.amount }
        }
      });
    } else if (action === 'complete') {
      updateData.status = 'COMPLETED';
      updateData.transactionId = transactionId;
    }

    await prisma.withdrawalRequest.update({
      where: { id },
      data: updateData
    });

    res.json({ success: true, message: `Withdrawal ${action}d successfully` });
  } catch (error) {
    logger.error('Withdrawal process error:', error);
    res.status(500).json({ success: false, message: 'Failed to process withdrawal' });
  }
});

// Bot management
router.get('/bots', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const [bots, total] = await Promise.all([
      prisma.user.findMany({
        where: { isBot: true },
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          botStatistics: true,
          _count: {
            select: {
              gameParticipations: true,
              matchmakingQueues: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where: { isBot: true } })
    ]);

    res.json({
      success: true,
      bots: bots.map(bot => ({
        id: bot.id,
        name: bot.name,
        phoneNumber: bot.phoneNumber,
        createdAt: bot.createdAt,
        gamesPlayed: bot.botStatistics?.gamesPlayed || 0,
        gamesWon: bot.botStatistics?.gamesWon || 0,
        gamesLost: bot.botStatistics?.gamesLost || 0,
        winRate: bot.botStatistics?.gamesPlayed > 0 
          ? ((bot.botStatistics.gamesWon / bot.botStatistics.gamesPlayed) * 100).toFixed(2)
          : 0,
        totalEarnings: bot.botStatistics?.totalEarnings || 0,
        lastGameAt: bot.botStatistics?.lastGameAt,
        inQueue: bot._count.matchmakingQueues > 0,
        status: bot._count.matchmakingQueues > 0 ? 'IN_QUEUE' : 'AVAILABLE'
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Bots fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bots' });
  }
});

// Bot statistics
router.get('/bots/stats', adminAuth, async (req, res) => {
  try {
    const [
      totalBots,
      activeBots,
      botsInQueue,
      botsInGames,
      botPerformance
    ] = await Promise.all([
      prisma.user.count({ where: { isBot: true } }),
      prisma.user.count({ 
        where: { 
          isBot: true,
          botStatistics: {
            lastGameAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
            }
          }
        }
      }),
      prisma.matchmakingQueue.count({
        where: { user: { isBot: true } }
      }),
      prisma.gameParticipation.count({
        where: {
          user: { isBot: true },
          game: { status: { in: ['WAITING', 'PLAYING'] } }
        }
      }),
      prisma.botStatistics.aggregate({
        _avg: {
          gamesPlayed: true,
          gamesWon: true,
          totalEarnings: true
        },
        _sum: {
          gamesPlayed: true,
          gamesWon: true,
          totalEarnings: true
        }
      })
    ]);

    const avgWinRate = botPerformance._sum.gamesPlayed > 0 
      ? (botPerformance._sum.gamesWon / botPerformance._sum.gamesPlayed * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      stats: {
        totalBots,
        activeBots,
        botsInQueue,
        botsInGames,
        availableBots: totalBots - botsInQueue - botsInGames,
        performance: {
          totalGamesPlayed: botPerformance._sum.gamesPlayed || 0,
          totalGamesWon: botPerformance._sum.gamesWon || 0,
          totalEarnings: botPerformance._sum.totalEarnings || 0,
          avgWinRate: parseFloat(avgWinRate),
          avgGamesPerBot: botPerformance._avg.gamesPlayed || 0
        }
      }
    });
  } catch (error) {
    logger.error('Bot stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bot statistics' });
  }
});

// Create bot
router.post('/bots', adminAuth, async (req, res) => {
  try {
    const { name, skillLevel = 'intermediate' } = req.body;

    const bot = await prisma.user.create({
      data: {
        name: name || `Bot_${Date.now()}`,
        phoneNumber: `+91${Math.floor(Math.random() * 9000000000) + 1000000000}`,
        isBot: true,
        isVerified: true,
        botStatistics: {
          create: {
            memoryAccuracy: skillLevel === 'beginner' ? 0.3 : skillLevel === 'advanced' ? 0.7 : 0.5
          }
        }
      },
      include: { botStatistics: true }
    });

    res.json({ success: true, message: 'Bot created successfully', bot });
  } catch (error) {
    logger.error('Bot creation error:', error);
    res.status(500).json({ success: false, message: 'Failed to create bot' });
  }
});

// Update bot intelligence/skill
router.patch('/bots/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { skillLevel } = req.body;
    let memoryAccuracy = 0.5;
    if (skillLevel === 'beginner') memoryAccuracy = 0.3;
    else if (skillLevel === 'advanced') memoryAccuracy = 0.7;

    // Update botStatistics
    const bot = await prisma.user.update({
      where: { id },
      data: {
        botStatistics: {
          update: {
            memoryAccuracy
          }
        }
      },
      include: { botStatistics: true }
    });

    res.json({ success: true, message: 'Bot intelligence updated', bot });
  } catch (error) {
    logger.error('Bot update error:', error);
    res.status(500).json({ success: false, message: 'Failed to update bot' });
  }
});

// Delete bot
router.delete('/bots/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if bot is in active game
    const activeGame = await prisma.gameParticipation.findFirst({
      where: {
        userId: id,
        game: { status: { in: ['WAITING', 'PLAYING'] } }
      }
    });

    if (activeGame) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete bot that is in an active game' 
      });
    }

    await prisma.user.delete({ where: { id } });

    res.json({ success: true, message: 'Bot deleted successfully' });
  } catch (error) {
    logger.error('Bot deletion error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete bot' });
  }
});

// Feedback management
router.get('/feedback', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;

    const [feedback, total] = await Promise.all([
      prisma.feedback.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          user: {
            select: { id: true, name: true, phoneNumber: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.feedback.count({ where })
    ]);

    res.json({
      success: true,
      feedback,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Feedback fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch feedback' });
  }
});

// Respond to feedback
router.post('/feedback/:id/respond', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { response, status = 'RESOLVED' } = req.body;

    const feedback = await prisma.feedback.update({
      where: { id },
      data: {
        response,
        status,
        updatedAt: new Date()
      }
    });

    res.json({ success: true, message: 'Response sent successfully', feedback });
  } catch (error) {
    logger.error('Feedback response error:', error);
    res.status(500).json({ success: false, message: 'Failed to send response' });
  }
});

// Financial reports
router.get('/reports/financial', adminAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const where = dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : {};

    const [
      deposits,
      withdrawals,
      gameEntries,
      gameWinnings,
      refunds
    ] = await Promise.all([
      prisma.transaction.aggregate({
        where: { ...where, type: 'DEPOSIT', status: 'COMPLETED' },
        _sum: { amount: true },
        _count: true
      }),
      prisma.transaction.aggregate({
        where: { ...where, type: 'WITHDRAWAL', status: 'COMPLETED' },
        _sum: { amount: true },
        _count: true
      }),
      prisma.transaction.aggregate({
        where: { ...where, type: 'GAME_ENTRY' },
        _sum: { amount: true },
        _count: true
      }),
      prisma.transaction.aggregate({
        where: { ...where, type: 'GAME_WINNING' },
        _sum: { amount: true },
        _count: true
      }),
      prisma.transaction.aggregate({
        where: { ...where, type: 'REFUND' },
        _sum: { amount: true },
        _count: true
      })
    ]);

    const totalRevenue = (deposits._sum.amount || 0);
    const totalPayouts = (withdrawals._sum.amount || 0) + (gameWinnings._sum.amount || 0);
    const netRevenue = totalRevenue - totalPayouts;
    const gameRevenue = (gameEntries._sum.amount || 0) - (gameWinnings._sum.amount || 0);

    res.json({
      success: true,
      report: {
        deposits: {
          amount: deposits._sum.amount || 0,
          count: deposits._count
        },
        withdrawals: {
          amount: withdrawals._sum.amount || 0,
          count: withdrawals._count
        },
        gameEntries: {
          amount: gameEntries._sum.amount || 0,
          count: gameEntries._count
        },
        gameWinnings: {
          amount: gameWinnings._sum.amount || 0,
          count: gameWinnings._count
        },
        refunds: {
          amount: refunds._sum.amount || 0,
          count: refunds._count
        },
        summary: {
          totalRevenue,
          totalPayouts,
          netRevenue,
          gameRevenue,
          profitMargin: totalRevenue > 0 ? ((netRevenue / totalRevenue) * 100).toFixed(2) : 0
        }
      }
    });
  } catch (error) {
    logger.error('Financial report error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate financial report' });
  }
});

// Referral management
router.get('/referrals', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    // Get users with referral codes and their referral statistics
    const [referrers, total] = await Promise.all([
      prisma.user.findMany({
        where: { 
          referralCode: { not: null },
          isBot: false
        },
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          wallet: true
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ 
        where: { 
          referralCode: { not: null },
          isBot: false
        }
      })
    ]);

    // Get referral statistics for each user
    const referralStats = await Promise.all(referrers.map(async (user) => {
      const [
        referralCount,
        referralBonusEarned,
        referredUsers
      ] = await Promise.all([
        prisma.user.count({
          where: { referredBy: user.referralCode }
        }),
        prisma.transaction.aggregate({
          where: { 
            userId: user.id, 
            type: { in: ['REFERRAL_BONUS', 'REFERRAL_SIGNUP_BONUS'] },
            status: 'COMPLETED'
          },
          _sum: { amount: true }
        }),
        prisma.user.findMany({
          where: { referredBy: user.referralCode },
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            createdAt: true,
            isVerified: true
          },
          take: 5,
          orderBy: { createdAt: 'desc' }
        })
      ]);

      return {
        ...user,
        referralCount,
        referralBonusEarned: referralBonusEarned._sum.amount || 0,
        referredUsers
      };
    }));

    res.json({
      success: true,
      referrals: referralStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Referrals fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch referral data' });
  }
});

// Referral details for specific user
router.get('/referrals/:userId', adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const [
      referredUsers,
      referralTransactions,
      referralStats
    ] = await Promise.all([
      prisma.user.findMany({
        where: { referredBy: user.referralCode },
        include: {
          wallet: true,
          _count: {
            select: {
              gameParticipations: true,
              transactions: { where: { type: 'DEPOSIT', status: 'COMPLETED' } }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.transaction.findMany({
        where: { 
          userId: user.id, 
          type: { in: ['REFERRAL_BONUS', 'REFERRAL_SIGNUP_BONUS'] }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.transaction.aggregate({
        where: { 
          userId: user.id, 
          type: { in: ['REFERRAL_BONUS', 'REFERRAL_SIGNUP_BONUS'] },
          status: 'COMPLETED'
        },
        _sum: { amount: true },
        _count: true
      })
    ]);

    res.json({
      success: true,
      user,
      referredUsers,
      referralTransactions,
      stats: {
        totalReferrals: referredUsers.length,
        totalBonusEarned: referralStats._sum.amount || 0,
        totalBonusTransactions: referralStats._count
      }
    });
  } catch (error) {
    logger.error('Referral details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch referral details' });
  }
});

// Website data management
router.get('/website-data', adminAuth, async (req, res) => {
  try {
    const { type = 'all', page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    let data = {};

    if (type === 'all' || type === 'contact') {
      const [contacts, contactsTotal] = await Promise.all([
        prisma.contactSubmission.findMany({
          skip: type === 'contact' ? parseInt(skip) : 0,
          take: type === 'contact' ? parseInt(limit) : 10,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.contactSubmission.count()
      ]);
      data.contacts = { data: contacts, total: contactsTotal };
    }

    if (type === 'all' || type === 'feedback') {
      const [websiteFeedback, feedbackTotal] = await Promise.all([
        prisma.websiteFeedback.findMany({
          skip: type === 'feedback' ? parseInt(skip) : 0,
          take: type === 'feedback' ? parseInt(limit) : 10,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.websiteFeedback.count()
      ]);
      data.websiteFeedback = { data: websiteFeedback, total: feedbackTotal };
    }

    if (type === 'all' || type === 'newsletter') {
      const [newsletters, newsletterTotal] = await Promise.all([
        prisma.newsletterSubscription.findMany({
          skip: type === 'newsletter' ? parseInt(skip) : 0,
          take: type === 'newsletter' ? parseInt(limit) : 10,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.newsletterSubscription.count()
      ]);
      data.newsletters = { data: newsletters, total: newsletterTotal };
    }

    if (type === 'all' || type === 'downloads') {
      const [downloads, downloadsTotal] = await Promise.all([
        prisma.downloadTracking.findMany({
          skip: type === 'downloads' ? parseInt(skip) : 0,
          take: type === 'downloads' ? parseInt(limit) : 10,
          orderBy: { timestamp: 'desc' }
        }),
        prisma.downloadTracking.count()
      ]);
      data.downloads = { data: downloads, total: downloadsTotal };
    }

    // Get summary stats
    const [
      totalContacts,
      totalWebsiteFeedback,
      totalNewsletters,
      totalDownloads
    ] = await Promise.all([
      prisma.contactSubmission.count(),
      prisma.websiteFeedback.count(),
      prisma.newsletterSubscription.count(),
      prisma.downloadTracking.count()
    ]);

    res.json({
      success: true,
      data,
      stats: {
        totalContacts,
        totalWebsiteFeedback,
        totalNewsletters,
        totalDownloads
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        type
      }
    });
  } catch (error) {
    logger.error('Website data fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch website data' });
  }
});

// Analytics endpoint
router.get('/analytics', adminAuth, async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    // Calculate date range based on period
    let startDate = new Date();
    switch (period) {
      case 'today':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    const [
      userGrowth,
      revenueAnalytics,
      gameAnalytics,
      topUsers
    ] = await Promise.all([
      // User growth analytics
      Promise.all([
        prisma.user.count({
          where: { 
            isBot: false,
            createdAt: { gte: startDate }
          }
        }),
        prisma.user.count({
          where: { 
            isBot: false,
            updatedAt: { gte: startDate }
          }
        })
      ]),
      
      // Revenue analytics
      Promise.all([
        prisma.transaction.aggregate({
          where: {
            type: 'DEPOSIT',
            status: 'COMPLETED',
            createdAt: { gte: startDate }
          },
          _sum: { amount: true }
        }),
        prisma.transaction.aggregate({
          where: {
            type: 'WITHDRAWAL',
            status: 'COMPLETED',
            createdAt: { gte: startDate }
          },
          _sum: { amount: true }
        })
      ]),
      
      // Game analytics
      Promise.all([
        prisma.game.count({
          where: { createdAt: { gte: startDate } }
        }),
        prisma.game.findMany({
          where: { 
            status: 'FINISHED',
            finishedAt: { gte: startDate }
          },
          select: { createdAt: true, finishedAt: true }
        }),
        prisma.game.groupBy({
          by: ['type'],
          where: { createdAt: { gte: startDate } },
          _count: { type: true },
          orderBy: { _count: { type: 'desc' } },
          take: 1
        })
      ]),
      
      // Top performing users
      prisma.user.findMany({
        where: { isBot: false },
        include: {
          wallet: true,
          _count: {
            select: {
              gameParticipations: true
            }
          }
        },
        take: 10,
        orderBy: {
          wallet: {
            withdrawableBalance: 'desc'
          }
        }
      })
    ]);

    const [newUsers, activeUsers] = userGrowth;
    const [totalDeposits, totalWithdrawals] = revenueAnalytics;
    const [gamesPlayed, finishedGames, popularGameType] = gameAnalytics;
    const avgGameMinutes = (() => {
      if (!Array.isArray(finishedGames) || finishedGames.length === 0) return 0;
      const sumMs = finishedGames.reduce((acc, g) => {
        const start = new Date(g.createdAt).getTime();
        const end = g.finishedAt ? new Date(g.finishedAt).getTime() : start;
        const diff = Math.max(0, end - start);
        return acc + diff;
      }, 0);
      return Math.round((sumMs / finishedGames.length) / 60000);
    })();

    // Calculate top users with their statistics
    const topUsersWithStats = await Promise.all(topUsers.map(async (user) => {
      const [gamesWon, totalWinnings, totalDeposits] = await Promise.all([
        prisma.gameParticipation.count({
          where: { userId: user.id, rank: 1 }
        }),
        prisma.transaction.aggregate({
          where: { userId: user.id, type: 'GAME_WINNING', status: 'COMPLETED' },
          _sum: { amount: true }
        }),
        prisma.transaction.aggregate({
          where: { userId: user.id, type: 'DEPOSIT', status: 'COMPLETED' },
          _sum: { amount: true }
        })
      ]);

      return {
        id: user.id,
        name: user.name || user.phoneNumber,
        gamesPlayed: user._count.gameParticipations,
        winRate: user._count.gameParticipations > 0 ? ((gamesWon / user._count.gameParticipations) * 100).toFixed(2) : 0,
        totalWinnings: totalWinnings._sum.amount || 0,
        totalDeposits: totalDeposits._sum.amount || 0
      };
    }));

    res.json({
      success: true,
      analytics: {
        userGrowth: {
          newUsers,
          activeUsers,
          retentionRate: newUsers > 0 ? ((activeUsers / newUsers) * 100).toFixed(2) : 0
        },
        revenue: {
          totalDeposits: totalDeposits._sum.amount || 0,
          totalWithdrawals: totalWithdrawals._sum.amount || 0,
          netRevenue: (totalDeposits._sum.amount || 0) - (totalWithdrawals._sum.amount || 0)
        },
        games: {
          gamesPlayed,
          avgGameDuration: `${avgGameMinutes}m`,
          popularGameType: popularGameType[0]?.type || 'LUDO'
        },
        topUsers: topUsersWithStats
      }
    });
  } catch (error) {
    logger.error('Analytics fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics data' });
  }
});

module.exports = router;