import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { createAuthToken, isValidToken, deleteToken } from '../db/index.js';
import { AuthConfig } from '../types.js';

// Constant-time comparison to prevent timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function createAuthRouter(config: AuthConfig): Router {
  const router = Router();

  // Generate a session token
  function generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  // POST /api/auth/login
  router.post('/login', (req: Request, res: Response) => {
    const { username, password, token } = req.body;

    // Token-based auth
    if (config.type === 'token') {
      const providedToken = typeof token === 'string' ? token : '';
      if (config.token && timingSafeEqual(providedToken, config.token)) {
        const sessionToken = generateToken();
        createAuthToken(sessionToken);
        return res.json({ success: true, token: sessionToken });
      }
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    // Password-based auth
    if (config.type === 'password') {
      const providedUser = typeof username === 'string' ? username : '';
      const providedPass = typeof password === 'string' ? password : '';
      if (
        config.adminUser && config.adminPassword &&
        timingSafeEqual(providedUser, config.adminUser) &&
        timingSafeEqual(providedPass, config.adminPassword)
      ) {
        const sessionToken = generateToken();
        createAuthToken(sessionToken);
        return res.json({ success: true, token: sessionToken });
      }
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    return res.status(400).json({ success: false, error: 'Invalid auth type' });
  });

  // POST /api/auth/logout
  router.post('/logout', (req: Request, res: Response) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      deleteToken(token);
    }
    res.json({ success: true });
  });

  // GET /api/auth/verify
  router.get('/verify', requireAuth, (req: Request, res: Response) => {
    res.json({ success: true });
  });

  return router;
}

// Auth middleware
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ success: false, error: 'No token provided' });
    return;
  }

  if (!isValidToken(token)) {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
    return;
  }

  next();
}