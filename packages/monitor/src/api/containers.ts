import { Router, Request, Response } from 'express';
import { getInstance, getContainersByInstance } from '../db/index.js';
import { sendToInstance, isInstanceConnected } from '../ws/manager.js';
import { requireAuth } from './auth.js';
import { v4 as uuidv4 } from 'uuid';

export function createContainersRouter(): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);

  // GET /api/instances/:id/containers
  router.get('/', (req: Request, res: Response) => {
    const instance = getInstance(req.params.instanceId);
    if (!instance) {
      return res.status(404).json({ success: false, error: 'Instance not found' });
    }

    const containers = getContainersByInstance(req.params.instanceId);
    res.json({ success: true, containers });
  });

  // POST /api/instances/:id/containers/:cid/stop
  router.post('/:cid/stop', async (req: Request, res: Response) => {
    const { instanceId, cid } = req.params;

    if (!isInstanceConnected(instanceId)) {
      return res.status(400).json({ success: false, error: 'Instance not connected' });
    }

    try {
      await sendToInstance(instanceId, {
        type: 'stop_container',
        requestId: uuidv4(),
        data: { containerId: cid },
      });
      res.json({ success: true, message: 'Stop command sent' });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/instances/:id/containers/:cid/logs
  router.get('/:cid/logs', async (req: Request, res: Response) => {
    const { instanceId, cid } = req.params;

    if (!isInstanceConnected(instanceId)) {
      return res.status(400).json({ success: false, error: 'Instance not connected' });
    }

    try {
      const logs = await sendToInstance<{ logs: string }>(instanceId, {
        type: 'get_container_logs',
        requestId: uuidv4(),
        data: { containerId: cid },
      });
      res.json({ success: true, ...logs });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  return router;
}