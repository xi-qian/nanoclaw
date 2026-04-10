import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { createAuthToken, isValidToken, deleteToken } from '../db/index.js';
import { AuthConfig } from '../config.js';

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
      if (token === config.token) {
        const sessionToken = generateToken();
        createAuthToken(sessionToken);
        return res.json({ success: true, token: sessionToken });
      }
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    // Password-based auth
    if (config.type === 'password') {
      if (username === config.adminUser && password === config.adminPassword) {
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
export function requireAuth(req: Request, res: Response, next: Function): void {
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