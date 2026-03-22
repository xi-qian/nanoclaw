import Database from 'better-sqlite3';

const db = new Database('/root/project/nanoclaw-fork/nanoclaw/store/messages.db');

// 更新群组注册，使用文件夹名称而不是绝对路径
const chatJid = 'feishu:oc_93dac2e93467e6c7eff34210368cbdc0';
const folderName = 'feishu-main';  // 只使用文件夹名称

const now = new Date().toISOString();
db.prepare(`
  UPDATE registered_groups 
  SET folder = ?, name = ?
  WHERE jid = ?
`).run(folderName, 'Feishu Main', chatJid);

console.log('✅ 群组记录已更新');
console.log(`   文件夹: ${folderName}`);

// 验证
const groups = db.prepare('SELECT jid, name, folder FROM registered_groups').all();
console.table(groups);

db.close();
