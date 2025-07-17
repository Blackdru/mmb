const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const logger = require('../config/logger');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'budzee-admin-secret-key-2025';

// Admin authentication middleware
const adminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = { username: decoded.username, role: decoded.role };
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// Ensure directories exist
const ensureDirectories = () => {
  const apkDir = path.join(__dirname, '../../public/apks');
  const updatesDir = path.join(__dirname, '../../public/updates');
  
  if (!fs.existsSync(apkDir)) {
    fs.mkdirSync(apkDir, { recursive: true });
  }
  if (!fs.existsSync(updatesDir)) {
    fs.mkdirSync(updatesDir, { recursive: true });
  }
};

// Configure multer for APK uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureDirectories();
    cb(null, path.join(__dirname, '../../public/apks'));
  },
  filename: (req, file, cb) => {
    const version = req.body.version || 'unknown';
    cb(null, `Budzee-v${version}.apk`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.android.package-archive' || 
        file.originalname.endsWith('.apk')) {
      cb(null, true);
    } else {
      cb(new Error('Only APK files are allowed'));
    }
  }
});

// Get current version info
router.get('/latest-version.json', (req, res) => {
  try {
    const versionFile = path.join(__dirname, '../../public/updates/latest-version.json');
    
    if (fs.existsSync(versionFile)) {
      const versionData = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      res.json(versionData);
    } else {
      res.json({
        version: "1.0.0",
        apkUrl: null,
        type: "optional",
        notes: "No updates available"
      });
    }
  } catch (error) {
    logger.error('Error reading version file:', error);
    res.status(500).json({ success: false, message: 'Failed to read version info' });
  }
});

// Publish new update (Admin only)
router.post('/publish-update', adminAuth, upload.single('apk'), (req, res) => {
  try {
    const { version, type, notes } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'APK file is required' });
    }
    
    if (!version || !type || !notes) {
      return res.status(400).json({ 
        success: false, 
        message: 'Version, type, and notes are required' 
      });
    }

    // Get server URL from environment or use localhost
    const serverUrl = process.env.SERVER_URL || 'http://localhost:8080';
    
    const versionData = {
      version,
      apkUrl: `${serverUrl}/apks/${req.file.filename}`,
      type, // 'mandatory' or 'optional'
      notes,
      publishedAt: new Date().toISOString(),
      fileSize: req.file.size
    };

    // Save version info
    const versionFile = path.join(__dirname, '../../public/updates/latest-version.json');
    fs.writeFileSync(versionFile, JSON.stringify(versionData, null, 2));

    logger.info(`New app update published: v${version} (${type})`);
    
    res.json({
      success: true,
      message: 'Update published successfully',
      data: versionData
    });

  } catch (error) {
    logger.error('Error publishing update:', error);
    res.status(500).json({ success: false, message: 'Failed to publish update' });
  }
});

// Get update history (Admin only)
router.get('/history', adminAuth, (req, res) => {
  try {
    const apkDir = path.join(__dirname, '../../public/apks');
    const versionFile = path.join(__dirname, '../../public/updates/latest-version.json');
    
    let currentVersion = null;
    if (fs.existsSync(versionFile)) {
      currentVersion = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    }

    const apkFiles = fs.existsSync(apkDir) ? fs.readdirSync(apkDir) : [];
    const history = apkFiles.map(file => {
      const filePath = path.join(apkDir, file);
      const stats = fs.statSync(filePath);
      return {
        filename: file,
        size: stats.size,
        createdAt: stats.birthtime,
        isCurrent: currentVersion && file === path.basename(currentVersion.apkUrl)
      };
    });

    res.json({
      success: true,
      currentVersion,
      history: history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    });

  } catch (error) {
    logger.error('Error getting update history:', error);
    res.status(500).json({ success: false, message: 'Failed to get update history' });
  }
});

// Rollback to previous version (Admin only)
router.post('/rollback', adminAuth, (req, res) => {
  try {
    const { version, type, notes, filename } = req.body;
    
    if (!version || !filename) {
      return res.status(400).json({ 
        success: false, 
        message: 'Version and filename are required' 
      });
    }

    // Get server URL from environment or use localhost
    const serverUrl = process.env.SERVER_URL || 'http://localhost:8080';
    
    const versionData = {
      version,
      apkUrl: `${serverUrl}/apks/${filename}`,
      type: type || 'optional',
      notes: notes || `Rollback to version ${version}`,
      publishedAt: new Date().toISOString(),
      fileSize: 0 // Will be updated if file exists
    };

    // Check if file exists
    const filePath = path.join(__dirname, '../../public/apks', filename);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      versionData.fileSize = stats.size;
    }

    // Save version info
    const versionFile = path.join(__dirname, '../../public/updates/latest-version.json');
    fs.writeFileSync(versionFile, JSON.stringify(versionData, null, 2));

    logger.info(`Rolled back to app version: v${version}`);
    
    res.json({
      success: true,
      message: 'Successfully rolled back to previous version',
      data: versionData
    });

  } catch (error) {
    logger.error('Error rolling back update:', error);
    res.status(500).json({ success: false, message: 'Failed to rollback update' });
  }
});

module.exports = router;