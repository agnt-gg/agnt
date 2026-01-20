import session from "express-session";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

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
  async authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    
    if (!token || token === 'null' || token === 'undefined') {
      console.log('No token provided, continuing as unauthenticated');
      req.user = { isAuthenticated: false };
      return next();
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