import Database from 'better-sqlite3';

const db = new Database('/root/project/nanoclaw-fork/nanoclaw/store/messages.db', { readonly: true });

console.log('\n=== 最近的5条消息 ===');
const messages = db.prepare('SELECT * FROM messages ORDER BY rowid DESC LIMIT 5').all();
console.table(messages);

console.log('\n=== 所有聊天 ===');
const chats = db.prepare('SELECT * FROM chats ORDER BY last_message_time DESC LIMIT 10').all();
console.table(chats);

db.close();
