// User Session Rate Limiting Middleware
const userRateLimits = new Map();

const rateLimitMiddleware = (req, res, next) => {
  const userId = req.user?.id;
  if (!userId) return next();

  const now = Date.now();
  const userLimit = userRateLimits.get(userId) || { count: 0, resetTime: now + 60000 };

  // Reset counter every minute
  if (now > userLimit.resetTime) {
    userLimit.count = 0;
    userLimit.resetTime = now + 60000;
  }

  // Allow max 10 game joins per minute
  if (userLimit.count >= 10) {
    return res.status(429).json({
      success: false,
      message: 'Rate limit exceeded. Maximum 10 game joins per minute.',
      retryAfter: Math.ceil((userLimit.resetTime - now) / 1000)
    });
  }

  userLimit.count++;
  userRateLimits.set(userId, userLimit);
  next();
};

module.exports = { rateLimitMiddleware };