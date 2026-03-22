import Database from 'better-sqlite3';

const db = new Database('/root/project/nanoclaw-fork/nanoclaw/store/messages.db');

// 删除所有会话数据
db.prepare('DELETE FROM sessions').run();

// 同时删除 IPC 目录中的旧文件
import { execSync } from 'child_process';
try {
  execSync('rm -f /root/project/nanoclaw-fork/nanoclaw/data/ipc/feishu-main/input/*');
  console.log('✅ IPC 输入文件已清除');
} catch (e) {
  // 忽略错误
}

console.log('✅ 所有会话数据和 IPC 文件已清除');
db.close();
