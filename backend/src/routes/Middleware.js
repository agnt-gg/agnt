import session from "express-session";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import db from "../models/database/index.js";

dotenv.config();

class Middleware {
  constructor() {
    this.sessionMiddleware = session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { 
        secure: process.env.NODE_ENV === "production", // set to true if using https
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    });
  }
  getSessionMiddleware() {
    return this.sessionMiddleware;
  }

  /**
   * Sync remote authenticated user to local database
   * Creates or updates user record when using TRUST_REMOTE_AUTH mode
   */
  async syncRemoteUserToLocal(decoded) {
    if (!decoded || !decoded.id) return;

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
    // This is used in "semi-local" mode where tokens are issued by remote auth server
    if (process.env.TRUST_REMOTE_AUTH === 'true') {
      try {
        // Decode without verification (just parse the JWT)
        const decoded = jwt.decode(token);

        if (decoded && decoded.id) {
          // Sync user to local database (create or update)
          await this.syncRemoteUserToLocal(decoded);

          req.user = {
            isAuthenticated: true,
            id: decoded.id,
            userId: decoded.id,
            email: decoded.email,
            auth_type: decoded.auth_type
          };

          // Store token and user data in session for backend operations
          if (req.session) {
            req.session.userToken = token;
            req.session.userData = req.user;
            req.session.lastActivity = Date.now();
          }

          console.log('✅ Trusted remote auth token for user:', decoded.email);
          return next();
        }
      } catch (err) {
        console.log('Failed to decode remote auth token:', err.message);
      }
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = {
        isAuthenticated: true,
        id: decoded.id,
        userId: decoded.id,
        email: decoded.email,
        auth_type: decoded.auth_type
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