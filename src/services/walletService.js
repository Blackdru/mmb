const Razorpay = require('razorpay');
const crypto = require('crypto');
const prisma = require('../config/database');
const logger = require('../config/logger');
const { safeNumber, validateAmount, toPaise } = require('../utils/numberUtils');

class WalletService {
  constructor() {
    // Ensure Razorpay keys are loaded from environment variables
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      logger.error('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not configured. Razorpay functionalities will be unavailable.');
      this.razorpay = null; // Set to null to indicate it's not configured
    } else {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });
      logger.info('Razorpay instance initialized.');
    }
    
    // Track ongoing deductions to prevent race conditions
    this.ongoingDeductions = new Set();
  }

  async getWallet(userId) {
    try {
      let wallet = await prisma.wallet.findUnique({
        where: { userId }
      });

      // Create wallet if it doesn't exist
      if (!wallet) {
        logger.info(`Creating new wallet for user ${userId}`);
        wallet = await prisma.wallet.create({
          data: {
            userId,
            balance: 0,
            gameBalance: 0,
            withdrawableBalance: 0
          }
        });
      }

      return wallet;
    } catch (error) {
      logger.error(`Get wallet error for user ${userId}:`, error);
      throw new Error('Failed to get wallet');
    }
  }

  async getWalletBalance(userId) {
    try {
      const wallet = await this.getWallet(userId);
      const gameBalance = safeNumber(wallet.gameBalance, 0);
      const withdrawableBalance = safeNumber(wallet.withdrawableBalance, 0);
      const calculatedBalance = gameBalance + withdrawableBalance;
      
      return {
        balance: calculatedBalance, // Always calculate as sum of game + withdrawable
        gameBalance: gameBalance,
        withdrawableBalance: withdrawableBalance
      };
    } catch (error) {
      logger.error(`Get wallet balance error for user ${userId}:`, error);
      throw new Error('Failed to get wallet balance');
    }
  }

  async createTransaction(userId, type, amount, status, description, razorpayOrderId = null, gameId = null) {
    try {
      // Ensure amount is a number for Prisma
      const numericAmount = parseFloat(amount);
      if (isNaN(numericAmount)) {
        logger.error(`Invalid amount for transaction: ${amount}`);
        throw new Error('Invalid amount for transaction');
      }

      return await prisma.transaction.create({
        data: {
          userId,
          type,
          amount: numericAmount,
          status,
          description,
          razorpayOrderId,
          gameId
        }
      });
    } catch (error) {
      logger.error(`Create transaction error for user ${userId}:`, error);
      throw new Error('Failed to create transaction');
    }
  }

  async createDepositOrder(userId, amount) {
    try {
      logger.info(`Creating deposit order for user ${userId}, amount: ${amount}`);
      
      const numericAmount = parseFloat(amount);
      if (isNaN(numericAmount) || numericAmount < 10) {
        logger.warn(`Invalid deposit amount: ${amount} for user ${userId}`);
        throw new Error('Minimum deposit amount is ₹10');
      }

      if (numericAmount > 50000) {
        logger.warn(`Deposit amount too high: ${amount} for user ${userId}`);
        throw new Error('Maximum deposit amount is ₹50,000');
      }

      if (!this.razorpay) {
        logger.error('Razorpay not configured for deposit order creation');
        throw new Error('Payment gateway not configured. Please try again later.');
      }

      // Check if user exists
      const userExists = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!userExists) {
        logger.error(`User not found for deposit: ${userId}`);
        throw new Error('User not found');
      }

      const options = {
        amount: Math.round(numericAmount * 100), // Convert to paise and round
        currency: 'INR',
        receipt: `dep_${userId.slice(0, 10)}_${Date.now()}`.slice(0, 40), // Ensure receipt is within limits
        notes: {
          userId: userId,
          type: 'WALLET_DEPOSIT',
          amount: numericAmount.toString()
        }
      };

      logger.info(`Creating Razorpay order with options:`, { ...options, notes: { ...options.notes, userId: 'HIDDEN' } });

      const order = await this.razorpay.orders.create(options);
      logger.info(`Razorpay order created successfully: ${order.id}`);
      
      // Create pending transaction
      const transaction = await this.createTransaction(
        userId,
        'DEPOSIT',
        numericAmount,
        'PENDING',
        `Wallet deposit of ₹${numericAmount}`,
        order.id
      );

      logger.info(`Deposit transaction created: ${transaction.id} for order: ${order.id}`);

      return {
        success: true,
        order: order,
        transactionId: transaction.id
      };
    } catch (error) {
      logger.error(`Create deposit order error for user ${userId}:`, error);
      
      // Provide more specific error messages
      if (error.message.includes('Razorpay')) {
        throw new Error('Payment gateway error. Please try again.');
      } else if (error.message.includes('amount')) {
        throw error; // Pass through amount validation errors
      } else if (error.message.includes('User not found')) {
        throw error; // Pass through user validation errors
      } else {
        throw new Error('Failed to create deposit order. Please try again.');
      }
    }
  }

  async processDeposit(userId, amount, razorpayOrderId, razorpayPaymentId, razorpaySignature) {
    try {
      // Find pending transaction
      const transaction = await prisma.transaction.findFirst({
        where: {
          userId,
          razorpayOrderId,
          status: 'PENDING',
          type: 'DEPOSIT'
        }
      });

      if (!transaction) {
        logger.warn(`Deposit transaction not found or already processed for user ${userId}, order ${razorpayOrderId}`);
        return { success: false, message: 'Transaction not found or already processed' };
      }

      // Verify payment signature (crucial for security)
      if (this.razorpay) {
        const generatedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                                       .update(razorpayOrderId + "|" + razorpayPaymentId)
                                       .digest('hex');
        if (generatedSignature !== razorpaySignature) {
          logger.error(`Razorpay signature mismatch for user ${userId}, order ${razorpayOrderId}`);
          // Update transaction to FAILED if signature doesn't match
          await prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: 'FAILED', description: 'Signature verification failed' }
          });
          return { success: false, message: 'Payment verification failed' };
        }
      } else {
        logger.warn('Razorpay not configured. Skipping signature verification for deposit.');
      }

      // Update transaction and wallet in a database transaction
      const result = await prisma.$transaction(async (tx) => {
        // Update transaction status
        const updatedTransaction = await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            status: 'COMPLETED',
            razorpayPaymentId,
            razorpaySignature
          }
        });

        // Ensure wallet exists before updating balance
        await tx.wallet.upsert({
          where: { userId },
          create: { 
            userId, 
            balance: 0,
            gameBalance: 0,
            withdrawableBalance: 0
          },
          update: {}
        });

        // Update wallet balances - deposits go to gameBalance (can be used for playing)
        const updatedWallet = await tx.wallet.update({
          where: { userId },
          data: {
            balance: { increment: parseFloat(amount) },
            gameBalance: { increment: parseFloat(amount) } // Deposits can be used for games
          }
        });

        return { transaction: updatedTransaction, wallet: updatedWallet };
      });

      logger.info(`Deposit completed: User ${userId}, Amount: ${amount}, Transaction ID: ${result.transaction.id}`);

      return {
        success: true,
        message: 'Deposit completed successfully',
        balance: parseFloat(result.wallet.balance),
        gameBalance: parseFloat(result.wallet.gameBalance),
        withdrawableBalance: parseFloat(result.wallet.withdrawableBalance),
        transactionId: result.transaction.id
      };
    } catch (error) {
      logger.error(`Process deposit error for user ${userId}, order ${razorpayOrderId}:`, error);
      return { success: false, message: 'Failed to process deposit' };
    }
  }

  async createWithdrawalRequest(userId, amount, method, details) {
    try {
      const numericAmount = parseFloat(amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
        throw new Error('Invalid withdrawal amount');
      }

      if (numericAmount < 100) {
        throw new Error('Minimum withdrawal amount is ₹100');
      }

      const wallet = await this.getWallet(userId);

      // Check if user has enough withdrawable balance (only winnings can be withdrawn)
      if (parseFloat(wallet.withdrawableBalance) < numericAmount) {
        logger.warn(`Insufficient withdrawable balance: User ${userId}, Has: ${wallet.withdrawableBalance}, Wants: ${numericAmount}`);
        return { 
          success: false, 
          message: `Insufficient withdrawable balance. You can only withdraw winnings (₹${wallet.withdrawableBalance} available). Referral bonuses and deposits can only be used for playing games.` 
        };
      }

      let withdrawalData = {
        userId,
        amount: numericAmount,
        method: method.toUpperCase(),
        status: 'PENDING'
      };

      const methodUpper = method.toUpperCase();
      if (!['BANK', 'UPI'].includes(methodUpper)) {
        throw new Error('Invalid withdrawal method. Supported: BANK, UPI');
      }
      
      withdrawalData.method = methodUpper;
      
      switch (methodUpper) {
        case 'BANK':
          if (!details.accountNumber || !details.ifscCode || !details.accountHolder || !details.fullName) {
            throw new Error('Complete bank details are required: Account Number, IFSC Code, Account Holder Name, Full Name');
          }
          withdrawalData.bankAccountNumber = details.accountNumber;
          withdrawalData.bankIfscCode = details.ifscCode;
          withdrawalData.bankAccountHolder = details.accountHolder;
          withdrawalData.bankFullName = details.fullName;
          break;
        case 'UPI':
          if (!details.upiId || !details.fullName) {
            throw new Error('UPI ID and Full Name are required');
          }
          withdrawalData.upiId = details.upiId;
          withdrawalData.upiFullName = details.fullName;
          break;
      }

      const result = await prisma.$transaction(async (tx) => {
        const withdrawalRequest = await tx.withdrawalRequest.create({
          data: withdrawalData
        });

        const transaction = await tx.transaction.create({
          data: {
            userId,
            type: 'WITHDRAWAL',
            amount: numericAmount,
            status: 'PENDING',
            description: `Withdrawal request of ₹${numericAmount} via ${method.toUpperCase()}`,
            metadata: {
              withdrawalRequestId: withdrawalRequest.id,
              method: method,
              requestedAt: new Date().toISOString()
            }
          }
        });

        // Deduct from withdrawable balance only
        const updatedWallet = await tx.wallet.update({
          where: { userId },
          data: {
            balance: { decrement: numericAmount },
            withdrawableBalance: { decrement: numericAmount }
          }
        });

        return { withdrawalRequest, transaction, wallet: updatedWallet };
      });

      logger.info(`Withdrawal request created: User ${userId}, Amount: ${numericAmount}, Method: ${method}, Request ID: ${result.withdrawalRequest.id}`);

      return {
        success: true,
        message: 'Withdrawal request submitted successfully',
        withdrawalRequestId: result.withdrawalRequest.id,
        transactionId: result.transaction.id,
        estimatedProcessingTime: '1-3 business days'
      };
    } catch (error) {
      logger.error(`Create withdrawal request error for user ${userId}:`, error);
      return { success: false, message: error.message || 'Failed to create withdrawal request' };
    }
  }

  async getWithdrawalRequests(userId, page = 1, limit = 20) {
    try {
      const withdrawalRequests = await prisma.withdrawalRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      });

      const total = await prisma.withdrawalRequest.count({
        where: { userId }
      });

      return {
        withdrawalRequests: withdrawalRequests.map(req => ({
          ...req,
          amount: parseFloat(req.amount)
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error(`Get withdrawal requests error for user ${userId}:`, error);
      throw new Error('Failed to get withdrawal requests');
    }
  }

  async updateWithdrawalStatus(withdrawalRequestId, status, adminNotes = null, transactionId = null) {
    try {
      const withdrawalRequest = await prisma.withdrawalRequest.findUnique({
        where: { id: withdrawalRequestId }
      });

      if (!withdrawalRequest) {
        throw new Error('Withdrawal request not found');
      }

      const updateData = {
        status: status.toUpperCase(),
        updatedAt: new Date()
      };

      if (status.toUpperCase() === 'COMPLETED') {
        updateData.processedAt = new Date();
        updateData.transactionId = transactionId;
      }

      if (adminNotes) {
        updateData.adminNotes = adminNotes;
      }

      // Update withdrawal request
      const updatedRequest = await prisma.$transaction(async (tx) => {
        const updated = await tx.withdrawalRequest.update({
          where: { id: withdrawalRequestId },
          data: updateData
        });

        // Update corresponding transaction
        await tx.transaction.updateMany({
          where: {
            userId: withdrawalRequest.userId,
            type: 'WITHDRAWAL',
            metadata: {
              path: ['withdrawalRequestId'],
              equals: withdrawalRequestId
            }
          },
          data: {
            status: status.toUpperCase(),
            description: `Withdrawal ${status.toLowerCase()} - ${adminNotes || 'Admin action'}`
          }
        });

        // If rejected or cancelled, refund the amount to withdrawable balance
        if (['REJECTED', 'CANCELLED'].includes(status.toUpperCase())) {
          await tx.wallet.update({
            where: { userId: withdrawalRequest.userId },
            data: {
              balance: { increment: parseFloat(withdrawalRequest.amount) },
              withdrawableBalance: { increment: parseFloat(withdrawalRequest.amount) }
            }
          });
        }

        return updated;
      });

      logger.info(`Withdrawal request ${withdrawalRequestId} status updated to ${status}`);
      return { success: true, withdrawalRequest: updatedRequest };
    } catch (error) {
      logger.error(`Update withdrawal status error for request ${withdrawalRequestId}:`, error);
      throw error;
    }
  }

  async deductGameEntry(userId, amount, gameId) {
    try {
      const numericAmount = parseFloat(amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
        throw new Error('Invalid amount for game entry');
      }

      // Create unique key for this deduction to prevent race conditions
      const deductionKey = `${userId}_${gameId}`;
      
      // Check if this deduction is already in progress
      if (this.ongoingDeductions.has(deductionKey)) {
        logger.warn(`❌ Deduction already in progress: User ${userId}, Game ${gameId}`);
        return { 
          success: false, 
          message: 'Entry fee deduction already in progress for this game'
        };
      }

      // Mark deduction as in progress
      this.ongoingDeductions.add(deductionKey);

      try {
        // Enhanced duplicate detection with multiple checks
        const existingTransactions = await prisma.transaction.findMany({
          where: {
            userId,
            gameId,
            type: 'GAME_ENTRY',
            status: { in: ['COMPLETED', 'PENDING'] }
          },
          orderBy: { createdAt: 'desc' }
        });

        if (existingTransactions.length > 0) {
          const latestTransaction = existingTransactions[0];
          logger.warn(`❌ Duplicate game entry attempt: User ${userId} already has ${existingTransactions.length} entry fee transaction(s) for game ${gameId} (Latest: ${latestTransaction.id})`);
          return { 
            success: false, 
            message: 'Entry fee already deducted for this game',
            transactionId: latestTransaction.id,
            duplicateCount: existingTransactions.length
          };
        }

        // Use serializable transaction isolation to prevent race conditions
        const result = await prisma.$transaction(async (tx) => {
          // Triple-check for existing transaction within the transaction
          const existingTxInTransaction = await tx.transaction.findMany({
            where: {
              userId,
              gameId,
              type: 'GAME_ENTRY',
              status: { in: ['COMPLETED', 'PENDING'] }
            }
          });

          if (existingTxInTransaction.length > 0) {
            throw new Error(`Entry fee already deducted for game ${gameId} - found ${existingTxInTransaction.length} existing transactions`);
          }

          // Get current wallet state within transaction for accurate balance check
          const currentWallet = await tx.wallet.findUnique({ 
            where: { userId }
          });
          
          if (!currentWallet) {
            throw new Error('Wallet not found');
          }

          const gameBalanceAvailable = safeNumber(currentWallet.gameBalance, 0);
          const withdrawableBalanceAvailable = safeNumber(currentWallet.withdrawableBalance, 0);
          const currentTotalAvailable = gameBalanceAvailable + withdrawableBalanceAvailable;
          
          // STRICT balance check within transaction - prevent any negative balances
          if (currentTotalAvailable < numericAmount) {
            logger.warn(`❌ Insufficient balance in transaction: User ${userId}, Has: ₹${currentTotalAvailable} (Game: ₹${gameBalanceAvailable} + Withdrawable: ₹${withdrawableBalanceAvailable}), Wants: ₹${numericAmount}`);
            throw new Error(`Insufficient balance: You have ₹${currentTotalAvailable.toFixed(2)} but need ₹${numericAmount.toFixed(2)}`);
          }

          // Additional safety check - ensure no balance will go negative
          let gameBalanceDeduction = 0;
          let withdrawableBalanceDeduction = 0;
          
          if (gameBalanceAvailable >= numericAmount) {
            // Deduct entirely from game balance
            gameBalanceDeduction = numericAmount;
            withdrawableBalanceDeduction = 0;
          } else if (gameBalanceAvailable > 0) {
            // Deduct what we can from game balance, rest from withdrawable balance
            gameBalanceDeduction = gameBalanceAvailable;
            withdrawableBalanceDeduction = numericAmount - gameBalanceAvailable;
          } else {
            // Deduct entirely from withdrawable balance
            gameBalanceDeduction = 0;
            withdrawableBalanceDeduction = numericAmount;
          }

          // Final safety check - ensure no negative balances after deduction
          const finalGameBalance = gameBalanceAvailable - gameBalanceDeduction;
          const finalWithdrawableBalance = withdrawableBalanceAvailable - withdrawableBalanceDeduction;
          
          if (finalGameBalance < 0 || finalWithdrawableBalance < 0) {
            logger.error(`❌ Deduction would result in negative balance: User ${userId}, Final Game: ₹${finalGameBalance}, Final Withdrawable: ₹${finalWithdrawableBalance}`);
            throw new Error('Transaction would result in negative balance');
          }

          // Create transaction record
          const transaction = await tx.transaction.create({
            data: {
              userId,
              type: 'GAME_ENTRY',
              amount: numericAmount,
              status: 'COMPLETED',
              description: `Game entry fee for game ${gameId}`,
              gameId,
              metadata: {
                deductionTimestamp: new Date().toISOString(),
                preventDuplicateKey: `${userId}_${gameId}_${Date.now()}`,
                deductionAttemptId: deductionKey,
                gameBalanceDeduction: gameBalanceDeduction,
                withdrawableBalanceDeduction: withdrawableBalanceDeduction
              }
            }
          });

          // Update wallet balances with calculated deductions
          const updatedWallet = await tx.wallet.update({
            where: { userId },
            data: {
              balance: { decrement: numericAmount },
              gameBalance: { decrement: gameBalanceDeduction },
              withdrawableBalance: { decrement: withdrawableBalanceDeduction }
            }
          });

          // Verify final balances are not negative (additional safety check)
          const finalBalance = safeNumber(updatedWallet.balance, 0);
          const finalGameBal = safeNumber(updatedWallet.gameBalance, 0);
          const finalWithdrawableBal = safeNumber(updatedWallet.withdrawableBalance, 0);
          
          if (finalBalance < 0 || finalGameBal < 0 || finalWithdrawableBal < 0) {
            logger.error(`❌ CRITICAL: Negative balance detected after update: User ${userId}, Balance: ₹${finalBalance}, Game: ₹${finalGameBal}, Withdrawable: ₹${finalWithdrawableBal}`);
            throw new Error('Critical error: Negative balance detected after transaction');
          }

          return { transaction, wallet: updatedWallet };
        }, {
          isolationLevel: 'Serializable', // Highest isolation level to prevent race conditions
          maxWait: 5000, // Wait up to 5 seconds for transaction slot
          timeout: 10000, // Transaction timeout of 10 seconds
        });

        logger.info(`✅ Game entry deducted: User ${userId}, Amount: ${numericAmount}, Game: ${gameId}, TransId: ${result.transaction.id}`);

        return {
          success: true,
          balance: parseFloat(result.wallet.balance),
          gameBalance: parseFloat(result.wallet.gameBalance),
          withdrawableBalance: parseFloat(result.wallet.withdrawableBalance),
          transactionId: result.transaction.id
        };

      } finally {
        // Always remove from ongoing deductions
        this.ongoingDeductions.delete(deductionKey);
      }

    } catch (error) {
      logger.error(`❌ Deduct game entry error for user ${userId}, game ${gameId}:`, error);
      
      // Clean up ongoing deductions on error
      const deductionKey = `${userId}_${gameId}`;
      this.ongoingDeductions.delete(deductionKey);
      
      if (error.message.includes('Entry fee already deducted') || error.message.includes('existing transactions')) {
        return { 
          success: false, 
          message: 'Entry fee already deducted for this game',
          error: error.message
        };
      }
      
      if (error.message.includes('Insufficient balance')) {
        return {
          success: false,
          message: 'Insufficient balance'
        };
      }
      
      if (error.message.includes('already in progress')) {
        return {
          success: false,
          message: 'Entry fee deduction already in progress'
        };
      }
      
      throw error;
    }
  }

  async creditWallet(userId, amount, type, gameId = null, description = null) {
    try {
      const numericAmount = parseFloat(amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
        throw new Error('Invalid amount for credit');
      }

      // Ensure wallet exists
      await this.getWallet(userId);

      const result = await prisma.$transaction(async (tx) => {
        // Create transaction
        const transaction = await tx.transaction.create({
          data: {
            userId,
            type,
            amount: numericAmount,
            status: 'COMPLETED',
            description: description || `${type} of ₹${numericAmount}`,
            gameId
          }
        });

        let walletUpdate = {
          balance: { increment: numericAmount }
        };

        // Determine which balance to credit based on transaction type
        if (type === 'GAME_WINNING') {
          // Game winnings go to withdrawable balance (can be withdrawn)
          walletUpdate.withdrawableBalance = { increment: numericAmount };
        } else if (type === 'REFERRAL_BONUS' || type === 'REFERRAL_SIGNUP_BONUS') {
          // Referral bonuses go to game balance (can only be used for games)
          walletUpdate.gameBalance = { increment: numericAmount };
        } else if (type === 'DEPOSIT') {
          // Deposits go to game balance (can be used for games)
          walletUpdate.gameBalance = { increment: numericAmount };
        } else if (type === 'REFUND') {
          // Refunds go to game balance (can be used for games)
          walletUpdate.gameBalance = { increment: numericAmount };
        }

        const updatedWallet = await tx.wallet.update({
          where: { userId },
          data: walletUpdate
        });

        return { transaction, wallet: updatedWallet };
      });

      logger.info(`Wallet credited: User ${userId}, Amount: ${numericAmount}, Type: ${type}, TransId: ${result.transaction.id}`);

      return {
        success: true,
        balance: parseFloat(result.wallet.balance),
        gameBalance: parseFloat(result.wallet.gameBalance),
        withdrawableBalance: parseFloat(result.wallet.withdrawableBalance),
        transactionId: result.transaction.id
      };
    } catch (error) {
      logger.error(`Credit wallet error for user ${userId}, type ${type}:`, error);
      throw error;
    }
  }

  async getTransactionHistory(userId, page = 1, limit = 20, type = null) {
    try {
      const whereClause = { userId };
      if (type) {
        whereClause.type = type;
      }

      const transactions = await prisma.transaction.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      });

      const total = await prisma.transaction.count({
        where: whereClause
      });

      return {
        transactions: transactions.map(t => ({
          ...t,
          amount: parseFloat(t.amount)
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error(`Get transaction history error for user ${userId}:`, error);
      throw new Error('Failed to get transaction history');
    }
  }

  async getWalletStats(userId) {
    try {
      const stats = await prisma.transaction.groupBy({
        by: ['type'],
        where: { userId, status: 'COMPLETED' },
        _sum: { amount: true },
        _count: { id: true }
      });

      const wallet = await this.getWallet(userId);

      const formattedStats = {
        totalBalance: parseFloat(wallet.balance),
        gameBalance: parseFloat(wallet.gameBalance),
        withdrawableBalance: parseFloat(wallet.withdrawableBalance),
        totalDeposits: 0,
        totalWithdrawals: 0,
        totalGameEntries: 0,
        totalWinnings: 0,
        totalReferralBonuses: 0,
        transactionCounts: {}
      };

      stats.forEach(stat => {
        const amount = parseFloat(stat._sum.amount || 0);
        const count = stat._count.id;

        formattedStats.transactionCounts[stat.type] = count;

        switch (stat.type) {
          case 'DEPOSIT':
            formattedStats.totalDeposits = amount;
            break;
          case 'WITHDRAWAL':
            formattedStats.totalWithdrawals = amount;
            break;
          case 'GAME_ENTRY':
            formattedStats.totalGameEntries = amount;
            break;
          case 'GAME_WINNING':
            formattedStats.totalWinnings = amount;
            break;
          case 'REFERRAL_BONUS':
          case 'REFERRAL_SIGNUP_BONUS':
            formattedStats.totalReferralBonuses += amount;
            break;
        }
      });

      return formattedStats;
    } catch (error) {
      logger.error(`Get wallet stats error for user ${userId}:`, error);
      throw new Error('Failed to get wallet stats');
    }
  }
}

module.exports = new WalletService();