import { Router, Request, Response } from 'express';
import { getInstances, getInstance, getContainersByInstance } from '../db/index.js';
import { sendToInstance, isInstanceConnected } from '../ws/manager.js';
import { requireAuth } from './auth.js';
import { v4 as uuidv4 } from 'uuid';

export function createInstancesRouter(): Router {
  const router = Router();

  // All routes require auth
  router.use(requireAuth);

  // GET /api/instances - List all instances
  router.get('/', (req: Request, res: Response) => {
    const instances = getInstances();

    // Add connection status
    const result = instances.map((inst) => ({
      ...inst,
      connected: isInstanceConnected(inst.instance_id),
    }));

    res.json({ success: true, instances: result });
  });

  // GET /api/instances/:id - Get instance detail
  router.get('/:id', (req: Request, res: Response) => {
    const instance = getInstance(req.params.id);
    if (!instance) {
      return res.status(404).json({ success: false, error: 'Instance not found' });
    }

    const containers = getContainersByInstance(req.params.id);

    res.json({
      success: true,
      instance: {
        ...instance,
        connected: isInstanceConnected(instance.instance_id),
        containers,
      },
    });
  });

  // POST /api/instances/:id/restart - Restart instance
  router.post('/:id/restart', async (req: Request, res: Response) => {
    const instance = getInstance(req.params.id);
    if (!instance) {
      return res.status(404).json({ success: false, error: 'Instance not found' });
    }

    if (!isInstanceConnected(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Instance not connected' });
    }

    try {
      await sendToInstance(req.params.id, {
        type: 'restart',
        requestId: uuidv4(),
      });
      res.json({ success: true, message: 'Restart command sent' });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // POST /api/instances/:id/stop - Stop instance (disconnect)
  router.post('/:id/stop', (req: Request, res: Response) => {
    const instance = getInstance(req.params.id);
    if (!instance) {
      return res.status(404).json({ success: false, error: 'Instance not found' });
    }

    // Note: Actual stop requires the instance to implement it
    // For now, just mark as offline
    res.json({ success: true, message: 'Stop command not implemented on agent' });
  });

  return router;
}