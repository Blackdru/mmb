const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const router = express.Router();
const prisma = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'budzee-admin-secret-key-2025';

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }
    
    // Find admin user in database by username or email
    const admin = await prisma.admin.findFirst({
      where: {
        OR: [
          { username },
          { email: username } // Allow login with email as well
        ]
      }
    });
    
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    // Compare password
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      token,
      user: { username: admin.username, role: admin.role }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Create initial admin user if none exists
async function createInitialAdmin() {
  try {
    const adminCount = await prisma.admin.count();
    
    if (adminCount === 0) {
      // Create default admin user
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await prisma.admin.create({
        data: {
          username: 'admin',
          email: 'admin@budzee.com',
          password: hashedPassword,
          role: 'admin'
        }
      });
      console.log('✅ Default admin user created');
    }
  } catch (error) {
    console.error('Error creating initial admin:', error);
  }
}

// Call this function when the server starts
createInitialAdmin();

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

// Middleware for JWT authentication
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

// Middleware for superadmin role
function requireSuperAdmin(req, res, next) {
  if (req.admin && req.admin.role && req.admin.role.toLowerCase() === "superadmin") {
    return next();
  }
  return res.status(403).json({ success: false, message: "Superadmin access required" });
}

// List all admins (superadmin only)
router.get("/admins", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const admins = await prisma.admin.findMany({
      select: { id: true, username: true, email: true, role: true, createdAt: true, updatedAt: true }
    });
    res.json({ success: true, admins });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch admins" });
  }
});

// Create new admin (superadmin only)
router.post("/admins", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: "Username, email, and password required" });
    }
    
    // Validate role
    const validRoles = ['admin', 'moderator'];
    const adminRole = role && validRoles.includes(role.toLowerCase()) ? role.toLowerCase() : 'admin';
    
    const existing = await prisma.admin.findFirst({ where: { OR: [{ username }, { email }] } });
    if (existing) {
      return res.status(409).json({ success: false, message: "Username or email already exists" });
    }
    
    const hashedPassword = await bcrypt.hash(password, 12);
    const newAdmin = await prisma.admin.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role: adminRole
      },
      select: { id: true, username: true, email: true, role: true, createdAt: true, updatedAt: true }
    });
    
    console.log(`New admin created by ${req.admin.username}: ${newAdmin.username} (${newAdmin.role})`);
    res.status(201).json({ success: true, admin: newAdmin, message: "Admin created successfully" });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ success: false, message: "Failed to create admin" });
  }
});

// Update admin (superadmin only)
router.put("/admins/:id", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role } = req.body;
    
    // Prevent updating superadmin
    const targetAdmin = await prisma.admin.findUnique({ where: { id } });
    if (!targetAdmin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    
    if (targetAdmin.role.toLowerCase() === 'superadmin') {
      return res.status(403).json({ success: false, message: "Cannot modify SuperAdmin account" });
    }
    
    const updateData = {};
    if (username) updateData.username = username;
    if (email) updateData.email = email;
    if (role && ['admin', 'moderator'].includes(role.toLowerCase())) {
      updateData.role = role.toLowerCase();
    }
    
    // Check for conflicts
    if (username || email) {
      const existing = await prisma.admin.findFirst({ 
        where: { 
          AND: [
            { id: { not: id } },
            { OR: [
              ...(username ? [{ username }] : []),
              ...(email ? [{ email }] : [])
            ]}
          ]
        } 
      });
      if (existing) {
        return res.status(409).json({ success: false, message: "Username or email already exists" });
      }
    }
    
    const updatedAdmin = await prisma.admin.update({
      where: { id },
      data: updateData,
      select: { id: true, username: true, email: true, role: true, createdAt: true, updatedAt: true }
    });
    
    console.log(`Admin updated by ${req.admin.username}: ${updatedAdmin.username}`);
    res.json({ success: true, admin: updatedAdmin, message: "Admin updated successfully" });
  } catch (error) {
    console.error('Update admin error:', error);
    res.status(500).json({ success: false, message: "Failed to update admin" });
  }
});

// Delete admin (superadmin only)
router.delete("/admins/:id", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Prevent deleting superadmin
    const targetAdmin = await prisma.admin.findUnique({ where: { id } });
    if (!targetAdmin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    
    if (targetAdmin.role.toLowerCase() === 'superadmin') {
      return res.status(403).json({ success: false, message: "Cannot delete SuperAdmin account" });
    }
    
    // Prevent self-deletion
    if (targetAdmin.username === req.admin.username) {
      return res.status(403).json({ success: false, message: "Cannot delete your own account" });
    }
    
    await prisma.admin.delete({ where: { id } });
    
    console.log(`Admin deleted by ${req.admin.username}: ${targetAdmin.username}`);
    res.json({ success: true, message: "Admin deleted successfully" });
  } catch (error) {
    console.error('Delete admin error:', error);
    res.status(500).json({ success: false, message: "Failed to delete admin" });
  }
});

// Reset admin password (superadmin only)
router.post("/admins/:id/reset-password", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters long" });
    }
    
    // Prevent resetting superadmin password
    const targetAdmin = await prisma.admin.findUnique({ where: { id } });
    if (!targetAdmin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    
    if (targetAdmin.role.toLowerCase() === 'superadmin') {
      return res.status(403).json({ success: false, message: "Cannot reset SuperAdmin password" });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.admin.update({
      where: { id },
      data: { password: hashedPassword }
    });
    
    console.log(`Password reset by ${req.admin.username} for admin: ${targetAdmin.username}`);
    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: "Failed to reset password" });
  }
});

// Get admin profile
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const admin = await prisma.admin.findFirst({
      where: { username: req.admin.username },
      select: { id: true, username: true, email: true, role: true, createdAt: true, updatedAt: true }
    });
    
    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    
    res.json({ success: true, admin });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: "Failed to get profile" });
  }
});

// Change own password
router.post("/change-password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password required" });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters long" });
    }
    
    const admin = await prisma.admin.findFirst({
      where: { username: req.admin.username }
    });
    
    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    
    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, admin.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ success: false, message: "Current password is incorrect" });
    }
    
    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);
    await prisma.admin.update({
      where: { id: admin.id },
      data: { password: hashedNewPassword }
    });
    
    console.log(`Password changed by admin: ${admin.username}`);
    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: "Failed to change password" });
  }
});

module.exports = router;