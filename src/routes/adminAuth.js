const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'budzee-admin-secret-key-2025';

// Admin credentials (in production, store in database)
const ADMIN_USERS = {
  'admin': {
    password: 'password', // plain text for now
    role: 'admin'
  },
  'superadmin': {
    password: 'password', // plain text for now
    role: 'superadmin'
  }
};

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }
    
    const user = ADMIN_USERS[username];
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    if (password !== user.password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      token,
      user: { username, role: user.role }
    });
    
  } catch (error) {
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Verify token endpoint
router.get('/verify', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    
    res.json({
      success: true,
      user: { username: decoded.username, role: decoded.role }
    });
    
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
});

module.exports = router;