const admin = require('firebase-admin');
const logger = require('./logger');

class FirebaseService {
  constructor() {
    this.initialized = false;
    this.app = null;
  }

  initialize() {
    try {
      // Initialize Firebase Admin SDK
      // You'll need to add your Firebase service account key
      const serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID || "budzee-game",
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
      };

      if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
        logger.warn('Firebase credentials not configured. Push notifications will be disabled.');
        return false;
      }

      this.app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });

      this.initialized = true;
      logger.info('Firebase Admin SDK initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Firebase Admin SDK:', error);
      return false;
    }
  }

  async sendNotification(tokens, payload) {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    try {
      const message = {
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data || {},
        tokens: Array.isArray(tokens) ? tokens : [tokens],
        android: {
          notification: {
            icon: 'ic_launcher',
            color: '#3498db',
            sound: 'default',
            priority: 'high',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const response = await admin.messaging().sendMulticast(message);
      
      logger.info(`Push notification sent. Success: ${response.successCount}, Failed: ${response.failureCount}`);
      
      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
        responses: response.responses
      };
    } catch (error) {
      logger.error('Failed to send push notification:', error);
      throw error;
    }
  }

  async sendToTopic(topic, payload) {
    if (!this.initialized) {
      throw new Error('Firebase not initialized');
    }

    try {
      const message = {
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data || {},
        topic: topic,
        android: {
          notification: {
            icon: 'ic_launcher',
            color: '#3498db',
            sound: 'default',
            priority: 'high',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const response = await admin.messaging().send(message);
      logger.info(`Topic notification sent successfully: ${response}`);
      
      return {
        success: true,
        messageId: response
      };
    } catch (error) {
      logger.error('Failed to send topic notification:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }
}

const firebaseService = new FirebaseService();
module.exports = firebaseService;