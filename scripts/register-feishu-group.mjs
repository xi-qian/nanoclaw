import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database('/root/project/nanoclaw-fork/nanoclaw/store/messages.db');
const projectRoot = '/root/project/nanoclaw-fork/nanoclaw';

// 飞书群组 JID
const chatJid = 'feishu:oc_93dac2e93467e6c7eff34210368cbdc0';

// 创建群组文件夹
const groupFolder = path.join(projectRoot, 'groups', 'feishu-main');

if (!existsSync(groupFolder)) {
  mkdirSync(groupFolder, { recursive: true });
  console.log(`✅ 创建群组文件夹: ${groupFolder}`);
}

// 创建 CLAUDE.md
const claudeMdPath = path.join(groupFolder, 'CLAUDE.md');
if (!existsSync(claudeMdPath)) {
  const claudeMd = `# 飞书主群组

这是一个飞书单聊群组，配置为 NanoClaw 的主群组。

## 群组信息
- JID: ${chatJid}
- 类型: 飞书单聊 (p2p)
- 设置: 主群组 (所有消息都会触发 AI 回复)

## 使用说明
作为主群组，所有消息都会触发 AI 回复，无需 @Andy 前缀。
`;
  writeFileSync(claudeMdPath, claudeMd, 'utf-8');
  console.log(`✅ 创建 CLAUDE.md: ${claudeMdPath}`);
}

// 注册群组到数据库（提供所有必需字段）
const now = new Date().toISOString();
db.prepare(`
  INSERT OR REPLACE INTO registered_groups 
  (jid, name, folder, trigger_pattern, added_at, requires_trigger)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(
  chatJid,
  'Feishu Main',
  groupFolder,
  '^@Andy\\b',  // 触发器模式（虽然主群组不需要）
  now,
  0  // 不需要触发器（主群组）
);

// 设置为主群组（在单独的列中）
try {
  db.prepare(`UPDATE registered_groups SET is_main = 1 WHERE jid = ?`).run(chatJid);
} catch (e) {
  // is_main 列可能不存在，忽略
}

console.log(`\n✅ 群组已注册!`);
console.log(`   JID: ${chatJid}`);
console.log(`   名称: Feishu Main`);
console.log(`   文件夹: ${groupFolder}`);
console.log(`   主群组: 是`);
console.log(`   需要触发器: 否\n`);

// 验证注册
const registeredGroups = db.prepare('SELECT * FROM registered_groups').all();
console.log('=== 当前已注册的群组 ===');
console.table(registeredGroups);

db.close();
