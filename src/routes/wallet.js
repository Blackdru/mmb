const express = require('express');
const router = express.Router();
const walletService = require('../services/walletService');
const { walletSchemas } = require('../validation/schemas');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../config/logger');

// Get wallet balance
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const wallet = await walletService.getWalletBalance(req.user.id);
    res.json({ success: true, wallet });
  } catch (err) {
    logger.error('Get wallet balance error:', err);
    res.status(500).json({ success: false, message: 'Failed to get wallet balance' });
  }
});

// Deposit: create Razorpay order
router.post('/deposit', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 10) {
      return res.status(400).json({ success: false, message: 'Minimum deposit amount is ₹10' });
    }
    const result = await walletService.createDepositOrder(req.user.id, amount);
    res.json(result);
  } catch (err) {
    logger.error('Create deposit order error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to create deposit order' });
  }
});

// Deposit: verify payment
router.post('/deposit/verify', authenticateToken, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
    const result = await walletService.processDeposit(
      req.user.id, 
      amount, 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature
    );
    res.json(result);
  } catch (err) {
    logger.error('Verify deposit payment error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Withdraw
router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount, withdrawalDetails } = req.body;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ 
        success: false, 
        message: 'Minimum withdrawal amount is ₹100' 
      });
    }

    if (!withdrawalDetails) {
      return res.status(400).json({ 
        success: false, 
        message: 'Withdrawal details are required' 
      });
    }

    // Extract method and details from withdrawalDetails
    const method = withdrawalDetails.method;
    const details = withdrawalDetails.details;

    if (!method) {
      return res.status(400).json({ 
        success: false, 
        message: 'Withdrawal method is required' 
      });
    }

    if (!details) {
      return res.status(400).json({ 
        success: false, 
        message: 'Withdrawal details are required' 
      });
    }

    const result = await walletService.createWithdrawalRequest(req.user.id, amount, method, details);
    res.json(result);
  } catch (err) {
    logger.error('Create withdrawal request error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Get withdrawal requests
router.get('/withdrawals', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const result = await walletService.getWithdrawalRequests(req.user.id, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Get withdrawal requests error:', err);
    res.status(500).json({ success: false, message: 'Failed to get withdrawal requests' });
  }
});

// Transaction history
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const result = await walletService.getTransactionHistory(req.user.id, page, limit);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Get transaction history error:', err);
    res.status(500).json({ success: false, message: 'Failed to get transaction history' });
  }
});

module.exports = router;
