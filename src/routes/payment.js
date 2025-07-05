const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');
const walletService = require('../services/walletService');
const logger = require('../config/logger');

// Initialize Razorpay with error handling
let razorpay;
try {
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    console.log('✅ Razorpay initialized successfully');
  } else {
    console.warn('⚠️ Razorpay credentials not found, running in test mode');
  }
} catch (error) {
  console.error('❌ Razorpay initialization failed:', error);
}

// Middleware to log all requests
router.use((req, res, next) => {
  console.log(`=== PAYMENT ROUTE: ${req.method} ${req.path} ===`);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  console.log('Query:', req.query);
  console.log('==========================================');
  next();
});

// Test deposit route for debugging
router.post('/test-deposit', authenticateToken, async (req, res) => {
  try {
    console.log('=== TEST DEPOSIT DEBUG ===');
    console.log('Raw body:', req.body);
    console.log('Body type:', typeof req.body);
    console.log('Body keys:', Object.keys(req.body || {}));
    console.log('Content-Type:', req.headers['content-type']);
    console.log('User:', req.user);
    console.log('========================');
    
    const { amount } = req.body;
    
    if (!amount) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required',
        receivedBody: req.body,
        bodyType: typeof req.body,
        bodyKeys: Object.keys(req.body || {})
      });
    }
    
    res.json({
      success: true,
      message: 'Test deposit successful',
      amount: amount,
      receivedBody: req.body
    });
  } catch (error) {
    console.error('Test deposit error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      stack: error.stack
    });
  }
});

// Create order for deposit
router.post('/create-deposit-order', authenticateToken, async (req, res) => {
  try {
    console.log('=== CREATE DEPOSIT ORDER DEBUG ===');
    console.log('Raw body:', req.body);
    console.log('Body type:', typeof req.body);
    console.log('Body keys:', Object.keys(req.body || {}));
    console.log('Content-Type:', req.headers['content-type']);
    console.log('User:', req.user);
    console.log('=================================');
    
    const { amount } = req.body;
    const userId = req.user.id;

    // Better validation
    if (!req.body) {
      return res.status(400).json({
        success: false,
        message: 'Request body is missing',
        debug: {
          bodyReceived: req.body,
          contentType: req.headers['content-type']
        }
      });
    }

    if (!amount) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required',
        receivedBody: req.body,
        debug: {
          bodyType: typeof req.body,
          bodyKeys: Object.keys(req.body || {}),
          contentType: req.headers['content-type']
        }
      });
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount < 10) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required. Minimum deposit amount is ₹10',
        receivedAmount: amount,
        parsedAmount: numericAmount
      });
    }

    if (numericAmount > 50000) {
      return res.status(400).json({
        success: false,
        message: 'Maximum deposit amount is ₹50,000'
      });
    }

    // Create Razorpay order with error handling
    console.log('🔄 Creating Razorpay order for amount:', numericAmount);
    let order;
    
    if (razorpay) {
      try {
        order = await razorpay.orders.create({
          amount: Math.round(numericAmount * 100), 
          currency: 'INR',
           receipt: `dep_${userId.slice(0, 10)}_${Date.now()}`.slice(0, 40),
          notes: {
            userId,
            type: 'DEPOSIT'
          }
        });
        console.log('✅ Razorpay order created successfully:', order.id);
      } catch (razorpayError) {
        console.error('❌ Razorpay order creation failed:', razorpayError);
        return res.status(500).json({
          success: false,
          message: 'Payment gateway error. Please try again.',
          error: razorpayError.message,
          details: 'Razorpay order creation failed'
        });
      }
    } else {
      // Test mode - create mock order
      console.log('🧪 Creating mock order (test mode)');
      order = {
        id: `order_test_${Date.now()}`,
        amount: numericAmount * 100,
        currency: 'INR',
        receipt: `deposit_${userId}_${Date.now()}`,
        status: 'created'
      };
    }

    // Create transaction record
    console.log('🔄 Creating transaction record...');
    let transaction;
    try {
      transaction = await walletService.createTransaction(
        userId,
        'DEPOSIT',
        numericAmount,
        'PENDING',
        `Wallet deposit of ₹${numericAmount}`,
        order.id
      );
      console.log('✅ Transaction created successfully:', transaction.id);
    } catch (transactionError) {
      console.error('❌ Transaction creation failed:', transactionError);
      return res.status(500).json({
        success: false,
        message: 'Database error. Please try again.',
        error: transactionError.message,
        details: 'Transaction creation failed'
      });
    }

    console.log('🎉 Deposit order creation completed successfully');
    res.json({
      success: true,
      order,
      transactionId: transaction.id
    });

  } catch (error) {
    console.error('💥 Unexpected error in create-deposit-order:', error);
    logger.error('Create deposit order error:', error);
    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Verify deposit payment
router.post('/verify-deposit', authenticateToken, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
    const userId = req.user.id;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment details'
      });
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    // Get payment details from Razorpay
    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    
    if (payment.status !== 'captured') {
      return res.status(400).json({
        success: false,
        message: 'Payment not captured'
      });
    }

    // Process the deposit
    const result = await walletService.processDeposit(
      userId,
      amount,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Deposit successful',
        balance: result.balance,
        transactionId: result.transactionId
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }

  } catch (error) {
    logger.error('Verify deposit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify deposit'
    });
  }
});

// Create withdrawal request
router.post('/create-withdrawal', authenticateToken, async (req, res) => {
  try {
    const { amount, method, details } = req.body;
    const userId = req.user.id;

    if (!amount || amount < 100) {
      return res.status(400).json({
        success: false,
        message: 'Minimum withdrawal amount is ₹100'
      });
    }

    if (!method || !details) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal method and details are required'
      });
    }

    // Check wallet balance
    const wallet = await walletService.getWallet(userId);
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }

    // Create withdrawal request
    const result = await walletService.createWithdrawalRequest(userId, amount, method, details);

    if (result.success) {
      res.json({
        success: true,
        message: 'Withdrawal request created successfully',
        transactionId: result.transactionId,
        estimatedProcessingTime: '2-3 business days'
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }

  } catch (error) {
    logger.error('Create withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create withdrawal request'
    });
  }
});

// Get payment history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const type = req.query.type; // Optional filter by transaction type

    const history = await walletService.getTransactionHistory(userId, page, limit, type);

    res.json({
      success: true,
      ...history
    });

  } catch (error) {
    logger.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history'
    });
  }
});

// Get wallet balance
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const balance = await walletService.getWalletBalance(userId);

    res.json({
      success: true,
      balance: balance
    });

  } catch (error) {
    logger.error('Get balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch balance'
    });
  }
});

// Create order for game entry fees (SECURE - includes Razorpay key)
router.post('/create-order', authenticateToken, async (req, res) => {
  try {
    console.log('🎮 Creating game entry order...');
    const { amount, playerCount } = req.body;
    const userId = req.user.id;

    // Validation
    if (!amount || !playerCount) {
      return res.status(400).json({
        success: false,
        message: 'Amount and player count are required'
      });
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount < 1) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    // Create Razorpay order
    let order;
    if (razorpay) {
      try {
        order = await razorpay.orders.create({
          amount: Math.round(numericAmount * 100), // Convert to paise
          currency: 'INR',
          receipt: `game_${userId.slice(0, 10)}_${Date.now()}`.slice(0, 40),
          notes: {
            userId,
            type: 'GAME_ENTRY',
            playerCount: playerCount.toString()
          }
        });
        console.log('✅ Game entry order created:', order.id);
      } catch (razorpayError) {
        console.error('❌ Razorpay order creation failed:', razorpayError);
        return res.status(500).json({
          success: false,
          message: 'Payment gateway error. Please try again.'
        });
      }
    } else {
      // Test mode
      order = {
        id: `order_test_${Date.now()}`,
        amount: numericAmount * 100,
        currency: 'INR',
        receipt: `game_${userId}_${Date.now()}`,
        status: 'created'
      };
    }

    // Return order details with Razorpay key (SECURE)
    res.json({
      success: true,
      order,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID, // Securely provided from backend
      message: 'Order created successfully'
    });

  } catch (error) {
    console.error('💥 Create game order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order'
    });
  }
});

// Verify game entry payment
router.post('/verify-payment', authenticateToken, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const userId = req.user.id;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment details'
      });
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    // Get payment details from Razorpay (if not in test mode)
    if (razorpay) {
      try {
        const payment = await razorpay.payments.fetch(razorpay_payment_id);
        
        if (payment.status !== 'captured') {
          return res.status(400).json({
            success: false,
            message: 'Payment not captured'
          });
        }
      } catch (error) {
        console.error('Error fetching payment details:', error);
        // Continue with verification in test mode
      }
    }

    // Payment verified successfully
    console.log('✅ Game entry payment verified for user:', userId);
    
    res.json({
      success: true,
      message: 'Payment verified successfully',
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment'
    });
  }
});

// Get Razorpay key for frontend
router.get('/razorpay-key', (req, res) => {
  console.log('🔑 Razorpay key requested');
  console.log('RAZORPAY_KEY_ID:', process.env.RAZORPAY_KEY_ID ? 'Set' : 'Not set');
  console.log('RAZORPAY_KEY_SECRET:', process.env.RAZORPAY_KEY_SECRET ? 'Set' : 'Not set');
  console.log('Razorpay instance:', razorpay ? 'Initialized' : 'Not initialized');
  
  res.json({
    success: true,
    key: process.env.RAZORPAY_KEY_ID,
    isConfigured: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    isInitialized: !!razorpay
  });
});

// Test Razorpay connection
router.get('/test-razorpay', async (req, res) => {
  try {
    console.log('🧪 Testing Razorpay connection...');
    
    if (!razorpay) {
      return res.json({
        success: false,
        message: 'Razorpay not initialized',
        details: {
          keyId: process.env.RAZORPAY_KEY_ID ? 'Set' : 'Not set',
          keySecret: process.env.RAZORPAY_KEY_SECRET ? 'Set' : 'Not set'
        }
      });
    }
    
    // Try to create a test order
    const testOrder = await razorpay.orders.create({
      amount: 100, // ₹1 in paise
      currency: 'INR',
      receipt: `test_${Date.now()}`,
      notes: {
        test: true
      }
    });
    
    console.log('✅ Test order created:', testOrder.id);
    
    res.json({
      success: true,
      message: 'Razorpay is working correctly',
      testOrderId: testOrder.id,
      details: {
        keyId: process.env.RAZORPAY_KEY_ID,
        isInitialized: true
      }
    });
    
  } catch (error) {
    console.error('❌ Razorpay test failed:', error);
    res.json({
      success: false,
      message: 'Razorpay test failed',
      error: error.message,
      details: {
        keyId: process.env.RAZORPAY_KEY_ID ? 'Set' : 'Not set',
        keySecret: process.env.RAZORPAY_KEY_SECRET ? 'Set' : 'Not set'
      }
    });
  }
});

// Webhook for payment status updates (for future use)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const body = req.body.toString();

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    if (signature === expectedSignature) {
      const event = JSON.parse(body);
      
      // Handle different webhook events
      switch (event.event) {
        case 'payment.captured':
          // Handle successful payment
          logger.info('Payment captured:', event.payload.payment.entity.id);
          break;
        case 'payment.failed':
          // Handle failed payment
          logger.info('Payment failed:', event.payload.payment.entity.id);
          break;
        default:
          logger.info('Unhandled webhook event:', event.event);
      }

      res.status(200).json({ status: 'ok' });
    } else {
      res.status(400).json({ status: 'invalid signature' });
    }

  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).json({ status: 'error' });
  }
});

module.exports = router;