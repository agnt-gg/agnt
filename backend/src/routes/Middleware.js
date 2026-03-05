import session from "express-session";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import db from "../models/database/index.js";

dotenv.config();

class Middleware {
  constructor() {
    // Determine cookie security based on environment
    // TRUST_PROXY=true means we're behind a reverse proxy that handles HTTPS
    const trustProxy = process.env.TRUST_PROXY === 'true' || process.env.TRUST_REMOTE_AUTH === 'true';
    const isProduction = process.env.NODE_ENV === "production";

    this.sessionMiddleware = session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      proxy: trustProxy, // Trust the reverse proxy
      cookie: {
        // Only require secure cookies in production when NOT behind a trusted proxy
        // Behind a proxy, the proxy handles HTTPS and talks to us over HTTP
        secure: isProduction && !trustProxy,
        sameSite: trustProxy ? 'none' : 'lax', // Allow cross-site cookies behind proxy
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    });
  }

  /**
   * Extract user ID from JWT token payload
   * Supports multiple field names: id, userId, user_id, sub (standard JWT)
   */
  extractUserId(payload) {
    if (!payload) return null;
    return payload.id || payload.userId || payload.user_id || payload.sub || null;
  }
  getSessionMiddleware() {
    return this.sessionMiddleware;
  }

  /**
   * Sync remote authenticated user to local database
   * Creates or updates user record when using TRUST_REMOTE_AUTH mode
   */
  async syncRemoteUserToLocal(decoded) {
    const userId = this.extractUserId(decoded);
    if (!decoded || !userId) return;

    // Normalize decoded object to always have 'id' field
    decoded.id = userId;

    return new Promise((resolve, reject) => {
      // Check if user exists
      db.get('SELECT id, email FROM users WHERE id = ?', [decoded.id], (err, existingUser) => {
        if (err) {
          console.error('Error checking user existence:', err);
          return resolve(); // Don't block auth on DB error
        }

        if (existingUser) {
          // User exists - update email if changed
          if (decoded.email && existingUser.email !== decoded.email) {
            db.run(
              'UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
              [decoded.email, decoded.id],
              (updateErr) => {
                if (updateErr) {
                  console.error('Error updating user email:', updateErr);
                }
                resolve();
              }
            );
          } else {
            resolve();
          }
        } else {
          // User doesn't exist - create new record
          db.run(
            `INSERT INTO users (id, email, name, created_at, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [decoded.id, decoded.email || null, decoded.name || null],
            (insertErr) => {
              if (insertErr) {
                console.error('Error creating user record:', insertErr);
              } else {
                console.log('✅ Created local user record for:', decoded.email);
              }
              resolve();
            }
          );
        }
      });
    });
  }

  async authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token || token === 'null' || token === 'undefined') {
      console.log('No token provided, continuing as unauthenticated');
      req.user = { isAuthenticated: false };
      return next();
    }

    // If TRUST_REMOTE_AUTH is enabled, decode token without verification
    // This is used in hosted/proxy mode where tokens are issued by remote auth server
    if (process.env.TRUST_REMOTE_AUTH === 'true') {
      try {
        // Decode without verification (just parse the JWT)
        const decoded = jwt.decode(token);
        const userId = this.extractUserId(decoded);

        if (decoded && userId) {
          // Sync user to local database (create or update)
          await this.syncRemoteUserToLocal(decoded);

          req.user = {
            isAuthenticated: true,
            id: userId,
            userId: userId,
            email: decoded.email,
            auth_type: decoded.auth_type || 'remote'
          };

          // Store token and user data in session for backend operations
          if (req.session) {
            req.session.userToken = token;
            req.session.userData = req.user;
            req.session.lastActivity = Date.now();
          }

          // Auth successful - don't log email for privacy
          return next();
        }
      } catch (err) {
        console.log('Failed to decode remote auth token:', err.message);
      }
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = this.extractUserId(decoded);
      req.user = {
        isAuthenticated: true,
        id: userId,
        userId: userId,
        email: decoded.email,
        auth_type: decoded.auth_type || 'local'
      };

      // Store token and user data in session for backend operations
      if (req.session) {
        req.session.userToken = token;
        req.session.userData = req.user;
        req.session.lastActivity = Date.now();
      }

      // console.log('Authenticated user:', req.user);

      next();
    } catch (err) {
      console.log('Token verification failed, continuing as unauthenticated');
      req.user = { isAuthenticated: false };

      // Clear session data if token is invalid
      if (req.session) {
        delete req.session.userToken;
        delete req.session.userData;
      }

      next();
    }
  }
  
  // Helper method to get stored user token from session
  getUserTokenFromSession(req) {
    if (req.session && req.session.userToken && req.session.userData) {
      // Check if session is still valid (within 24 hours)
      const lastActivity = req.session.lastActivity || 0;
      const sessionTimeout = 24 * 60 * 60 * 1000; // 24 hours
      
      if (Date.now() - lastActivity < sessionTimeout) {
        return {
          token: req.session.userToken,
          user: req.session.userData
        };
      } else {
        // Session expired, clear it
        delete req.session.userToken;
        delete req.session.userData;
        delete req.session.lastActivity;
      }
    }
    return null;
  }
}

const middleware = new Middleware();
const sessionMiddleware = middleware.getSessionMiddleware();
const authenticateToken = middleware.authenticateToken.bind(middleware);
const getUserTokenFromSession = middleware.getUserTokenFromSession.bind(middleware);

export { sessionMiddleware, authenticateToken, getUserTokenFromSession };