import { loadConfig } from './config.js';
import { initDatabase } from './db/index.js';
import { createWebSocketServer, startHeartbeatChecker } from './ws/manager.js';
import { createHttpServer } from './server.js';

const config = loadConfig();

console.log('NanoClaw Monitor starting...');
console.log('Config:', { port: config.port, authType: config.auth.type });

// Initialize database
initDatabase(config.dataDir);
console.log('Database initialized');

// Start WebSocket server on port + 1
const wsPort = config.port + 1;
createWebSocketServer(wsPort);
console.log('WebSocket server started on port', wsPort);

// Start heartbeat checker
startHeartbeatChecker(config.heartbeatTimeout);

// Start HTTP server
const app = createHttpServer(config);
app.listen(config.port, () => {
  console.log('HTTP server started on port', config.port);
  console.log('Monitor ready!');
});