import Database from 'better-sqlite3';

const db = new Database('/root/project/nanoclaw-fork/nanoclaw/store/messages.db');

// 删除所有会话数据
db.prepare('DELETE FROM sessions').run();

console.log('✅ 所有会话数据已清除');
console.log('现在每次请求都会创建新会话');

db.close();
