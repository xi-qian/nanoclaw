import Database from 'better-sqlite3';

const db = new Database('/root/project/nanoclaw-fork/nanoclaw/store/messages.db', { readonly: true });

console.log('\n=== 所有消息（包含内容详情）===');
const messages = db.prepare('SELECT id, chat_jid, content, sender FROM messages ORDER BY rowid DESC LIMIT 5').all();
messages.forEach((msg, i) => {
  console.log(`\n[消息 ${i}]`);
  console.log(`  ID: ${msg.id}`);
  console.log(`  聊天: ${msg.chat_jid}`);
  console.log(`  发送者: ${msg.sender || '(空)'}`);
  console.log(`  内容: "${msg.content}"`);
  console.log(`  内容长度: ${msg.content.length} 字符`);
});

db.close();
