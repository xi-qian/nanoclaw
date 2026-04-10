import express from 'express';
import { Router } from 'express';
import path from 'path';
import { MonitorConfig } from './config.js';
import { createAuthRouter } from './api/auth.js';
import { createInstancesRouter } from './api/instances.js';
import { createContainersRouter } from './api/containers.js';
import { createGroupsRouter } from './api/groups.js';

export function createHttpServer(config: MonitorConfig): express.Application {
  const app = express();

  // Middleware
  app.use(express.json());

  // Serve static files from public directory
  const publicDir = path.join(import.meta.dirname, 'public');
  app.use(express.static(publicDir));

  // Health check (no auth)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Redirect /dashboard to dashboard.html
  app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(publicDir, 'dashboard.html'));
  });

  // Redirect /instance to instance.html
  app.get('/instance', (req, res) => {
    res.sendFile(path.join(publicDir, 'instance.html'));
  });

  // API routes
  const apiRouter = Router();

  // Auth routes (no auth required)
  apiRouter.use('/auth', createAuthRouter(config.auth));

  // Instance routes (auth required)
  apiRouter.use('/instances', createInstancesRouter());

  // Container routes (nested under instances)
  apiRouter.use('/instances/:instanceId/containers', createContainersRouter());

  // Group routes (nested under instances)
  apiRouter.use('/instances/:instanceId/groups', createGroupsRouter());

  app.use('/api', apiRouter);

  // Error handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({ success: false, error: err.message });
  });

  return app;
}