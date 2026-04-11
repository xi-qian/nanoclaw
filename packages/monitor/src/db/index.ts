import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function initDatabase(dataDir: string): Database.Database {
  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'monitor.db');
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent reads
  db.pragma('journal_mode = WAL');

  // Read and execute schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return db;
}

// Instance operations
export function upsertInstance(instance: {
  instanceId: string;
  hostname: string;
  version: string;
  startTime: string;
  mainGroup?: string;
  channels: string[];
  apiEndpoint?: string;
}): void {
  const stmt = getDb().prepare(`
    INSERT INTO instances (instance_id, hostname, version, start_time, main_group, channels, status, last_heartbeat, api_endpoint, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'running', CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(instance_id) DO UPDATE SET
      hostname = excluded.hostname,
      version = excluded.version,
      start_time = excluded.start_time,
      main_group = excluded.main_group,
      channels = excluded.channels,
      api_endpoint = excluded.api_endpoint,
      status = 'running',
      last_heartbeat = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(
    instance.instanceId,
    instance.hostname,
    instance.version,
    instance.startTime,
    instance.mainGroup || null,
    JSON.stringify(instance.channels),
    instance.apiEndpoint || null
  );
}

export function updateInstanceHeartbeat(
  instanceId: string,
  status: 'running' | 'idle' | 'error',
  containers: any[]
): void {
  const db = getDb();

  // Update instance
  const updateInstance = db.prepare(`
    UPDATE instances SET status = ?, last_heartbeat = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE instance_id = ?
  `);
  updateInstance.run(status, instanceId);

  // Update containers (upsert)
  const upsertContainer = db.prepare(`
    INSERT INTO containers (container_id, instance_id, name, group_folder, chat_jid, status, start_time, duration, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(container_id) DO UPDATE SET
      name = excluded.name,
      group_folder = excluded.group_folder,
      chat_jid = excluded.chat_jid,
      status = excluded.status,
      start_time = excluded.start_time,
      duration = excluded.duration,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const c of containers) {
    upsertContainer.run(
      c.containerId,
      instanceId,
      c.name,
      c.groupFolder,
      c.chatJid,
      c.status,
      c.startTime,
      c.duration || null
    );
  }
}

export function setInstanceOffline(instanceId: string): void {
  const stmt = getDb().prepare(`
    UPDATE instances SET status = 'offline', updated_at = CURRENT_TIMESTAMP
    WHERE instance_id = ?
  `);
  stmt.run(instanceId);
}

export function getInstances(): any[] {
  const stmt = getDb().prepare(`
    SELECT instance_id, hostname, version, start_time, main_group, channels, status, last_heartbeat, api_endpoint
    FROM instances
    ORDER BY updated_at DESC
  `);
  return stmt.all().map((row: any) => ({
    ...row,
    channels: JSON.parse(row.channels || '[]'),
  }));
}

export function getInstance(instanceId: string): any | null {
  const stmt = getDb().prepare(`
    SELECT instance_id, hostname, version, start_time, main_group, channels, status, last_heartbeat, api_endpoint
    FROM instances WHERE instance_id = ?
  `);
  const row = stmt.get(instanceId) as any;
  if (!row) return null;
  return {
    ...row,
    channels: JSON.parse(row.channels || '[]'),
  };
}

// Container operations
export function getContainersByInstance(instanceId: string): any[] {
  const stmt = getDb().prepare(`
    SELECT container_id, instance_id, name, group_folder, chat_jid, status, start_time, duration
    FROM containers WHERE instance_id = ?
    ORDER BY updated_at DESC
  `);
  return stmt.all(instanceId);
}

// Cache operations
export function setCache(data: {
  instanceId: string;
  type: 'skills' | 'memory' | 'groups';
  groupFolder?: string;
  data: any;
}): void {
  const stmt = getDb().prepare(`
    INSERT INTO cache (instance_id, type, group_folder, data, cached_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(instance_id, type, group_folder) DO UPDATE SET
      data = excluded.data,
      cached_at = CURRENT_TIMESTAMP
  `);
  stmt.run(data.instanceId, data.type, data.groupFolder || null, JSON.stringify(data.data));
}

export function getCache(instanceId: string, type: string, groupFolder?: string): any | null {
  const stmt = getDb().prepare(`
    SELECT data, cached_at FROM cache
    WHERE instance_id = ? AND type = ? AND (group_folder = ? OR (? IS NULL AND group_folder IS NULL))
  `);
  const row = stmt.get(instanceId, type, groupFolder || null, groupFolder || null) as any;
  if (!row) return null;
  return {
    data: JSON.parse(row.data),
    cachedAt: row.cached_at,
  };
}

// Auth operations
export function createAuthToken(token: string, expiresAt?: string): void {
  const stmt = getDb().prepare(`
    INSERT INTO auth_tokens (token, expires_at) VALUES (?, ?)
  `);
  stmt.run(token, expiresAt || null);
}

export function isValidToken(token: string): boolean {
  const stmt = getDb().prepare(`
    SELECT token FROM auth_tokens WHERE token = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
  `);
  return !!stmt.get(token);
}

export function deleteToken(token: string): void {
  const stmt = getDb().prepare(`DELETE FROM auth_tokens WHERE token = ?`);
  stmt.run(token);
}