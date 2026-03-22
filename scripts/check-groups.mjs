import Database from 'better-sqlite3';

const db = new Database('/root/project/nanoclaw-fork/nanoclaw/store/messages.db', { readonly: true });

console.log('\n=== 已注册的群组 ===');
const groups = db.prepare('SELECT * FROM registered_groups').all();
console.table(groups);

console.log('\n=== 路由状态 ===');
const state = db.prepare('SELECT * FROM router_state').all();
console.table(state);

db.close();
