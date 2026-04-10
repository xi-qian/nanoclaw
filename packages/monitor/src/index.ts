import { loadConfig } from './config.js';
import { initDatabase } from './db/index.js';
import { createWebSocketServer } from './ws/manager.js';

const config = loadConfig();

console.log('NanoClaw Monitor starting...');
console.log('Config:', { port: config.port, authType: config.auth.type });

// Initialize database
initDatabase(config.dataDir);
console.log('Database initialized');

// Start WebSocket server on port + 1 (e.g., 8081)
const wsPort = config.port + 1;
createWebSocketServer(wsPort);
console.log('WebSocket server started on port', wsPort);

// TODO: Start HTTP API server