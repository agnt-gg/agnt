import session from "express-session";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import db from "../models/database/index.js";
import { resolveSecret } from "../utils/secretResolver.js";
import { rememberSessionToken } from "../services/auth/sessionTokenCache.js";
import { isPermittedUser, NOT_A_MEMBER } from "../services/auth/tenantOwnership.js";

dotenv.config();

class Middleware {
  constructor() {
    // Determine cookie security based on environment
    // TRUST_PROXY=true means we're behind a reverse proxy that handles HTTPS
    const trustProxy = process.env.TRUST_PROXY === 'true' || process.env.TRUST_REMOTE_AUTH === 'true';
    const isProduction = process.env.NODE_ENV === "production";

    this.sessionMiddleware = session({
      // Was process.env.SESSION_SECRET, supplied by a committed backend/.env —
      // so every install shared one published cookie-signing key, and
      // express-session throws 'secret option required' when it is absent,
      // making that file a second hard boot dependency alongside encryption.js.
      //
      // 'ephemeral' on persist failure is deliberate: a session secret only
      // protects a 24-hour cookie that clients re-establish transparently, so
      // refusing to boot over an unwritable data directory would cause far
      // more harm than the regenerated secret it prevents. ENCRYPTION_KEY,
      // which guards data at rest, takes the opposite branch.
      secret: resolveSecret('SESSION_SECRET', { bytes: 64, onPersistFailure: 'ephemeral' }),
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

  /**
   * A genuine token is not the same thing as permission to be HERE.
   *
   * All three branches below establish only that the caller is a real AGNT
   * account. On a hosted tenant that was treated as permission, so any account
   * — and signup is open — got a session on somebody else's paid instance.
   * See services/auth/tenantOwnership.js.
   *
   * 403 AND NOT 401, deliberately. 401 means "your credential is bad, get a
   * new one", and a client that believes that will re-authenticate forever
   * against a token that is perfectly valid and will never be accepted here.
   * 403 with a reason lets the UI say the true thing: right account, wrong
   * instance.
   *
   * Every call site places this BEFORE syncRemoteUserToLocal. A refused caller
   * must leave nothing behind — a local users row, or a poisoned single-slot
   * session cache, are both effects a stranger should not be able to cause.
   */
  refuseNonMember(res, userId) {
    if (isPermittedUser(userId)) return false;
    console.warn(`[tenant] refused ${userId}: not a member of this instance`);
    res.status(403).json({
      success: false,
      error: 'This AGNT instance belongs to another account.',
      reason: NOT_A_MEMBER,
    });
    return true;
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
      req.user = { isAuthenticated: false };
      // A route that genuinely serves anonymous callers opts in explicitly with
      // authenticateTokenOptional. Everything else gets a 401, because a
      // handler that reads req.user.id will otherwise run with `undefined` and
      // its safety becomes an accident of how its query happens to behave.
      if (req.allowAnonymous) return next();
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        reason: 'missing',
      });
    }

    // If TRUST_REMOTE_AUTH is enabled, decode token without verification
    // This is used in hosted/proxy mode where tokens are issued by remote auth server
    if (process.env.TRUST_REMOTE_AUTH === 'true') {
      try {
        // Decode without verification (just parse the JWT)
        const decoded = jwt.decode(token);
        const userId = this.extractUserId(decoded);

        if (decoded && userId) {
          if (this.refuseNonMember(res, userId)) return;

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

          // Same reasoning as the verified branch below. This token was decoded
          // rather than verified locally — which is what TRUST_REMOTE_AUTH
          // means — but the remote API verifies it itself, so it is exactly the
          // right credential to forward there.
          rememberSessionToken(token, userId);

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
      if (this.refuseNonMember(res, userId)) return;

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

      // Also remember it OUTSIDE the session, so the parts of this backend that
      // run without a request — the email and webhook pollers, workflow nodes,
      // plugins — can present a credential to api.agnt.gg. Without this they
      // must call it anonymously, which is the reason those remote endpoints
      // cannot yet require authentication. See services/auth/sessionTokenCache.js.
      rememberSessionToken(token, userId);

      // console.log('Authenticated user:', req.user);

      next();
    } catch (err) {
      // LOCAL VERIFICATION FAILED. On a normal install that is the end of it:
      // this backend holds the issuer's signing key, so a signature it cannot
      // verify is a signature that is wrong.
      //
      // A HOSTED TENANT IS DIFFERENT. It deliberately holds a random, private
      // JWT_SECRET so that the published key is not sitting on an
      // internet-facing box, which means a genuine cloud token ALWAYS fails
      // here. Asking the issuer is not a fallback for a broken check — it is
      // the only check that can succeed, and it inspects material this process
      // does not have (the proof claim, keyed by a server-only secret).
      //
      // Opt-in via AGNT_AUTH_MODE=verify-remote, so desktop is bit-for-bit
      // unchanged: it verifies locally and never makes this call.
      const { isRemoteVerifyMode, verifyViaIssuer } = await import(
        '../services/auth/remoteTokenVerifier.js'
      );

      if (isRemoteVerifyMode()) {
        const remote = await verifyViaIssuer(token);
        if (remote.ok) {
          const userId = remote.user.id || remote.user.userId;
          // THE LIVE HOLE WAS HERE. The issuer confirms the token is genuine —
          // it says that for every account it has ever issued — and this path
          // read that as permission to use this instance.
          if (this.refuseNonMember(res, userId)) return;

          await this.syncRemoteUserToLocal({ ...remote.user, id: userId });

          req.user = {
            isAuthenticated: true,
            id: userId,
            userId,
            email: remote.user.email,
            auth_type: 'issuer-verified',
          };

          if (req.session) {
            req.session.userToken = token;
            req.session.userData = req.user;
            req.session.lastActivity = Date.now();
          }

          // Same reason as the verified branch: the pollers, workflow nodes and
          // plugins run with no request in scope and still need a credential to
          // present to api.agnt.gg. See services/auth/sessionTokenCache.js.
          rememberSessionToken(token, userId);
          return next();
        }
      }

      req.user = { isAuthenticated: false };

      // Clear session data if token is invalid
      if (req.session) {
        delete req.session.userToken;
        delete req.session.userData;
      }

      if (req.allowAnonymous) return next();
      // A presented-but-invalid token is a stronger signal than no token at
      // all: something is wrong (expired session, wrong secret, tampering).
      // Distinguish it so the client can tell "log in" from "log in again".
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        reason: 'invalid',
      });
    }
  }

  /**
   * Opt-in permissive variant: run the same token parsing, but let the request
   * through unauthenticated instead of rejecting. Handlers behind this MUST
   * check req.user.isAuthenticated themselves.
   *
   * This is the behaviour authenticateToken used to have for every route. It is
   * kept because serving anonymous callers is occasionally legitimate — but it
   * now has to be chosen deliberately per route rather than being the silent
   * default for all 252.
   */
  async authenticateTokenOptional(req, res, next) {
    req.allowAnonymous = true;
    return this.authenticateToken(req, res, next);
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
const authenticateTokenOptional = middleware.authenticateTokenOptional.bind(middleware);
const getUserTokenFromSession = middleware.getUserTokenFromSession.bind(middleware);

export { sessionMiddleware, authenticateToken, getUserTokenFromSession, authenticateTokenOptional };