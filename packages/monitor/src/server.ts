import express from 'express';
import { Router } from 'express';
import { MonitorConfig } from './config.js';
import { createAuthRouter } from './api/auth.js';
import { createInstancesRouter } from './api/instances.js';
import { createContainersRouter } from './api/containers.js';
import { createGroupsRouter } from './api/groups.js';

export function createHttpServer(config: MonitorConfig): express.Application {
  const app = express();

  // Middleware
  app.use(express.json());

  // Health check (no auth)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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