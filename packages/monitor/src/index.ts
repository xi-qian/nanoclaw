import { loadConfig } from './config.js';
import { initDatabase } from './db/index.js';

const config = loadConfig();

console.log('NanoClaw Monitor starting...');

// Initialize database
initDatabase(config.dataDir);
console.log('Database initialized');

// TODO: Start server