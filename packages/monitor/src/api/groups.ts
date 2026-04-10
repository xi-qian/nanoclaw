import { Router, Request, Response } from 'express';
import { getInstance, getCache, setCache } from '../db/index.js';
import { sendToInstance, isInstanceConnected } from '../ws/manager.js';
import { requireAuth } from './auth.js';
import { v4 as uuidv4 } from 'uuid';

export function createGroupsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // GET /api/instances/:id/groups
  router.get('/', async (req: Request, res: Response) => {
    const { instanceId } = req.params;

    // Try to get from connected instance
    if (isInstanceConnected(instanceId)) {
      try {
        const groups = await sendToInstance<any[]>(instanceId, {
          type: 'get_groups',
          requestId: uuidv4(),
        });
        // Cache the result
        setCache({ instanceId, type: 'groups', data: groups });
        return res.json({ success: true, groups, cached: false });
      } catch (err) {
        console.error('Failed to get groups:', err);
      }
    }

    // Return cached data if instance offline
    const cached = getCache(instanceId, 'groups');
    if (cached) {
      return res.json({ success: true, groups: cached.data, cached: true, cachedAt: cached.cachedAt });
    }

    res.status(400).json({ success: false, error: 'Instance not connected and no cached data' });
  });

  // GET /api/instances/:id/groups/:folder/skills
  router.get('/:folder/skills', async (req: Request, res: Response) => {
    const { instanceId, folder } = req.params;

    if (isInstanceConnected(instanceId)) {
      try {
        const skills = await sendToInstance<any[]>(instanceId, {
          type: 'get_skills',
          requestId: uuidv4(),
          data: { groupFolder: folder },
        });
        setCache({ instanceId, type: 'skills', groupFolder: folder, data: skills });
        return res.json({ success: true, skills, cached: false });
      } catch (err) {
        console.error('Failed to get skills:', err);
      }
    }

    const cached = getCache(instanceId, 'skills', folder);
    if (cached) {
      return res.json({ success: true, skills: cached.data, cached: true, cachedAt: cached.cachedAt });
    }

    res.status(400).json({ success: false, error: 'Instance not connected and no cached data' });
  });

  // PUT /api/instances/:id/groups/:folder/skills/:name
  router.put('/:folder/skills/:name', async (req: Request, res: Response) => {
    const { instanceId, folder, name } = req.params;
    const { content } = req.body;

    if (!isInstanceConnected(instanceId)) {
      return res.status(400).json({ success: false, error: 'Instance not connected' });
    }

    try {
      await sendToInstance(instanceId, {
        type: 'update_skill',
        requestId: uuidv4(),
        data: { groupFolder: folder, skillName: name, content },
      });
      // Update cache
      setCache({ instanceId, type: 'skills', groupFolder: folder, data: { name, content } });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // GET /api/instances/:id/groups/:folder/memory
  router.get('/:folder/memory', async (req: Request, res: Response) => {
    const { instanceId, folder } = req.params;

    if (isInstanceConnected(instanceId)) {
      try {
        const memory = await sendToInstance<any[]>(instanceId, {
          type: 'get_memory',
          requestId: uuidv4(),
          data: { groupFolder: folder },
        });
        setCache({ instanceId, type: 'memory', groupFolder: folder, data: memory });
        return res.json({ success: true, memory, cached: false });
      } catch (err) {
        console.error('Failed to get memory:', err);
      }
    }

    const cached = getCache(instanceId, 'memory', folder);
    if (cached) {
      return res.json({ success: true, memory: cached.data, cached: true, cachedAt: cached.cachedAt });
    }

    res.status(400).json({ success: false, error: 'Instance not connected and no cached data' });
  });

  // PUT /api/instances/:id/groups/:folder/memory/:filename
  router.put('/:folder/memory/:filename', async (req: Request, res: Response) => {
    const { instanceId, folder, filename } = req.params;
    const { content } = req.body;

    if (!isInstanceConnected(instanceId)) {
      return res.status(400).json({ success: false, error: 'Instance not connected' });
    }

    try {
      await sendToInstance(instanceId, {
        type: 'update_memory',
        requestId: uuidv4(),
        data: { groupFolder: folder, filename, content },
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  // DELETE /api/instances/:id/groups/:folder/memory/:filename
  router.delete('/:folder/memory/:filename', async (req: Request, res: Response) => {
    const { instanceId, folder, filename } = req.params;

    if (!isInstanceConnected(instanceId)) {
      return res.status(400).json({ success: false, error: 'Instance not connected' });
    }

    try {
      await sendToInstance(instanceId, {
        type: 'delete_memory',
        requestId: uuidv4(),
        data: { groupFolder: folder, filename },
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  return router;
}