-- Instances table
CREATE TABLE IF NOT EXISTS instances (
  instance_id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  version TEXT,
  start_time TEXT,
  main_group TEXT,
  channels TEXT, -- JSON array
  status TEXT DEFAULT 'idle',
  last_heartbeat TEXT,
  api_endpoint TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Containers table (last known state)
CREATE TABLE IF NOT EXISTS containers (
  container_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  name TEXT,
  group_folder TEXT,
  chat_jid TEXT,
  status TEXT,
  start_time TEXT,
  duration INTEGER,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (instance_id) REFERENCES instances(instance_id)
);

-- Auth tokens table
CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT
);

-- Cache table
CREATE TABLE IF NOT EXISTS cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'skills', 'memory', 'groups'
  group_folder TEXT,
  data TEXT, -- JSON
  cached_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(instance_id, type, group_folder)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_containers_instance ON containers(instance_id);
CREATE INDEX IF NOT EXISTS idx_cache_lookup ON cache(instance_id, type, group_folder);