const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
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
    
    req.admin = { id: decoded.id, username: decoded.username, role: decoded.role };
    next();
  } catch (error) {
    logger.error('Admin auth error:', error);
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// Admin login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password are required' 
      });
    }

    // Find admin by username
    const admin = await prisma.admin.findUnique({
      where: { username }
    });

    if (!admin) {
      logger.warn(`Failed login attempt for username: ${username}`);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid username or password' 
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password);
    if (!isValidPassword) {
      logger.warn(`Failed login attempt for username: ${username} - invalid password`);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid username or password' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: admin.id,
        username: admin.username, 
        role: admin.role 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    logger.info(`Admin login successful: ${admin.username} (${admin.role})`);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: admin.role
      }
    });

  } catch (error) {
    logger.error('Admin login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Verify token
router.get('/verify', adminAuth, async (req, res) => {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin.id },
      select: { id: true, username: true, email: true, role: true, createdAt: true }
    });

    if (!admin) {
      return res.status(401).json({ 
        success: false, 
        message: 'Admin not found' 
      });
    }

    res.json({
      success: true,
      user: admin
    });

  } catch (error) {
    logger.error('Token verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Token verification failed' 
    });
  }
});

// Get all admins (superadmin only)
router.get('/admins', adminAuth, async (req, res) => {
  try {
    // Check if user is superadmin
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Superadmin role required.' 
      });
    }

    const admins = await prisma.admin.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      admins
    });

  } catch (error) {
    logger.error('Get admins error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch admins' 
    });
  }
});

// Create new admin (superadmin only)
router.post('/admins', adminAuth, async (req, res) => {
  try {
    // Check if user is superadmin
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Superadmin role required.' 
      });
    }

    const { username, email, password, role } = req.body;

    // Validate input
    if (!username || !email || !password || !role) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 6 characters long' 
      });
    }

    if (!['admin', 'moderator'].includes(role)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid role. Must be admin or moderator' 
      });
    }

    // Check if username or email already exists
    const existingAdmin = await prisma.admin.findFirst({
      where: {
        OR: [
          { username },
          { email }
        ]
      }
    });

    if (existingAdmin) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username or email already exists' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create admin
    const newAdmin = await prisma.admin.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true
      }
    });

    logger.info(`New admin created: ${newAdmin.username} (${newAdmin.role}) by ${req.admin.username}`);

    res.json({
      success: true,
      message: 'Admin created successfully',
      admin: newAdmin
    });

  } catch (error) {
    logger.error('Create admin error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create admin' 
    });
  }
});

// Update admin (superadmin only)
router.put('/admins/:id', adminAuth, async (req, res) => {
  try {
    // Check if user is superadmin
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Superadmin role required.' 
      });
    }

    const { id } = req.params;
    const { username, email, role } = req.body;

    // Validate input
    if (!username || !email || !role) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username, email, and role are required' 
      });
    }

    if (!['admin', 'moderator'].includes(role)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid role. Must be admin or moderator' 
      });
    }

    // Check if admin exists
    const existingAdmin = await prisma.admin.findUnique({
      where: { id }
    });

    if (!existingAdmin) {
      return res.status(404).json({ 
        success: false, 
        message: 'Admin not found' 
      });
    }

    // Prevent updating superadmin
    if (existingAdmin.role === 'superadmin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot update superadmin account' 
      });
    }

    // Check if username or email already exists (excluding current admin)
    const duplicateAdmin = await prisma.admin.findFirst({
      where: {
        AND: [
          { id: { not: id } },
          {
            OR: [
              { username },
              { email }
            ]
          }
        ]
      }
    });

    if (duplicateAdmin) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username or email already exists' 
      });
    }

    // Update admin
    const updatedAdmin = await prisma.admin.update({
      where: { id },
      data: {
        username,
        email,
        role
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        updatedAt: true
      }
    });

    logger.info(`Admin updated: ${updatedAdmin.username} (${updatedAdmin.role}) by ${req.admin.username}`);

    res.json({
      success: true,
      message: 'Admin updated successfully',
      admin: updatedAdmin
    });

  } catch (error) {
    logger.error('Update admin error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update admin' 
    });
  }
});

// Reset admin password (superadmin only)
router.post('/admins/:id/reset-password', adminAuth, async (req, res) => {
  try {
    // Check if user is superadmin
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Superadmin role required.' 
      });
    }

    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 6 characters long' 
      });
    }

    // Check if admin exists
    const existingAdmin = await prisma.admin.findUnique({
      where: { id }
    });

    if (!existingAdmin) {
      return res.status(404).json({ 
        success: false, 
        message: 'Admin not found' 
      });
    }

    // Prevent resetting superadmin password
    if (existingAdmin.role === 'superadmin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot reset superadmin password' 
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.admin.update({
      where: { id },
      data: { password: hashedPassword }
    });

    logger.info(`Password reset for admin: ${existingAdmin.username} by ${req.admin.username}`);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to reset password' 
    });
  }
});

// Delete admin (superadmin only)
router.delete('/admins/:id', adminAuth, async (req, res) => {
  try {
    // Check if user is superadmin
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Superadmin role required.' 
      });
    }

    const { id } = req.params;

    // Check if admin exists
    const existingAdmin = await prisma.admin.findUnique({
      where: { id }
    });

    if (!existingAdmin) {
      return res.status(404).json({ 
        success: false, 
        message: 'Admin not found' 
      });
    }

    // Prevent deleting superadmin
    if (existingAdmin.role === 'superadmin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot delete superadmin account' 
      });
    }

    // Prevent self-deletion
    if (existingAdmin.id === req.admin.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot delete your own account' 
      });
    }

    // Delete admin
    await prisma.admin.delete({
      where: { id }
    });

    logger.info(`Admin deleted: ${existingAdmin.username} by ${req.admin.username}`);

    res.json({
      success: true,
      message: 'Admin deleted successfully'
    });

  } catch (error) {
    logger.error('Delete admin error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete admin' 
    });
  }
});

// Change own password
router.post('/change-password', adminAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Current password and new password are required' 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'New password must be at least 6 characters long' 
      });
    }

    // Get current admin
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin.id }
    });

    if (!admin) {
      return res.status(404).json({ 
        success: false, 
        message: 'Admin not found' 
      });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, admin.password);
    if (!isValidPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Current password is incorrect' 
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.admin.update({
      where: { id: req.admin.id },
      data: { password: hashedPassword }
    });

    logger.info(`Password changed for admin: ${admin.username}`);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to change password' 
    });
  }
});

module.exports = router;