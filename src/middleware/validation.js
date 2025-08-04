const Joi = require('joi');
const logger = require('../config/logger');

// Common validation schemas
const schemas = {
  phoneNumber: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)
    .required()
    .messages({
      'string.pattern.base': 'Invalid phone number format',
      'any.required': 'Phone number is required'
    }),
    
  otp: Joi.string()
    .length(6)
    .pattern(/^\d{6}$/)
    .required()
    .messages({
      'string.length': 'OTP must be 6 digits',
      'string.pattern.base': 'OTP must contain only numbers',
      'any.required': 'OTP is required'
    }),
    
  amount: Joi.number()
    .positive()
    .precision(2)
    .min(1)
    .max(100000)
    .required()
    .messages({
      'number.positive': 'Amount must be positive',
      'number.min': 'Minimum amount is ₹1',
      'number.max': 'Maximum amount is ₹100,000',
      'any.required': 'Amount is required'
    }),
    
  gameId: Joi.string()
    .min(10)
    .max(50)
    .required()
    .messages({
      'string.min': 'Invalid game ID',
      'string.max': 'Invalid game ID',
      'any.required': 'Game ID is required'
    }),
    
  userId: Joi.string()
    .min(10)
    .max(50)
    .required()
    .messages({
      'string.min': 'Invalid user ID',
      'string.max': 'Invalid user ID',
      'any.required': 'User ID is required'
    }),
    
  name: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z\s]+$/)
    .trim()
    .messages({
      'string.min': 'Name must be at least 2 characters',
      'string.max': 'Name cannot exceed 50 characters',
      'string.pattern.base': 'Name can only contain letters and spaces'
    }),
    
  email: Joi.string()
    .email()
    .max(100)
    .messages({
      'string.email': 'Invalid email format',
      'string.max': 'Email cannot exceed 100 characters'
    })
};

// Validation middleware factory
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    try {
      const { error, value } = schema.validate(req[property], {
        abortEarly: false,
        stripUnknown: true,
        convert: true
      });

      if (error) {
        const errorMessage = error.details
          .map(detail => detail.message)
          .join(', ');
          
        logger.warn(`Validation error for ${req.method} ${req.path}:`, errorMessage);
        
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }

      // Replace the original data with validated and sanitized data
      req[property] = value;
      next();
    } catch (err) {
      logger.error('Validation middleware error:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal validation error'
      });
    }
  };
};

// Common validation schemas for routes
const routeSchemas = {
  sendOTP: Joi.object({
    phoneNumber: schemas.phoneNumber
  }),
  
  verifyOTP: Joi.object({
    phoneNumber: schemas.phoneNumber,
    otp: schemas.otp,
    referralCode: Joi.string().optional().allow('')
  }),
  
  updateProfile: Joi.object({
    name: schemas.name.optional(),
    email: schemas.email.optional()
  }),
  
  deposit: Joi.object({
    amount: schemas.amount.min(10).max(50000)
  }),
  
  withdrawal: Joi.object({
    amount: schemas.amount.min(100).max(50000),
    method: Joi.string().valid('BANK', 'UPI').required(),
    bankDetails: Joi.when('method', {
      is: 'BANK',
      then: Joi.object({
        accountNumber: Joi.string().required(),
        ifscCode: Joi.string().required(),
        accountHolder: Joi.string().required(),
        fullName: Joi.string().required()
      }).required(),
      otherwise: Joi.forbidden()
    }),
    upiDetails: Joi.when('method', {
      is: 'UPI',
      then: Joi.object({
        upiId: Joi.string().required(),
        fullName: Joi.string().required()
      }).required(),
      otherwise: Joi.forbidden()
    })
  }),
  
  joinMatchmaking: Joi.object({
    gameType: Joi.string().valid('MEMORY').required(),
    maxPlayers: Joi.number().valid(2).required(),
    entryFee: Joi.number().min(0).max(10000).required()
  }),
  
  feedback: Joi.object({
    message: Joi.string().min(10).max(1000).required(),
    type: Joi.string().valid('GENERAL', 'BUG_REPORT', 'FEATURE_REQUEST', 'COMPLAINT', 'SUGGESTION').default('GENERAL')
  })
};

// Sanitization helpers
const sanitize = {
  phoneNumber: (phone) => {
    return phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
  },
  
  name: (name) => {
    return name.trim().replace(/\s+/g, ' ');
  },
  
  amount: (amount) => {
    return Math.round(parseFloat(amount) * 100) / 100; // Round to 2 decimal places
  }
};

module.exports = {
  validate,
  schemas,
  routeSchemas,
  sanitize
};