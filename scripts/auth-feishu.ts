#!/usr/bin/env node
/**
 * 飞书 OAuth 认证脚本
 * 运行此脚本以获取飞书 access_token
 */

import { FeishuOAuthClient } from '../src/feishu/oauth.js';
import { loadCredentials, saveCredentials } from '../src/feishu/auth.js';

async function main(): Promise<void> {
  console.log('🔑 飞书 OAuth 认证\n');

  // 加载现有凭证
  const credentials = loadCredentials();

  if (!credentials) {
    console.error('❌ 未找到飞书凭证文件');
    console.error('请先创建 store/auth/feishu/credentials.json 文件，包含 appId 和 appSecret\n');
    console.error('示例格式:');
    console.error(JSON.stringify(
      { appId: 'cli_xxxxxxxxxxxxx', appSecret: 'xxxxxxxxxxxxxxxxxxxx' },
      null,
      2,
    ));
    process.exit(1);
  }

  console.log(`✅ 已加载凭证 (appId: ${credentials.appId})`);

  // 创建 OAuth 客户端
  const oauthClient = new FeishuOAuthClient(credentials);

  try {
    // 执行认证流程
    const { credentials: updatedCredentials, tokens } = await oauthClient.authenticate();

    // 保存更新后的凭证
    await saveCredentials(updatedCredentials);

    console.log('\n✅ 认证成功！凭证已保存到 store/auth/feishu/credentials.json');
    console.log(`\n📝 Access Token 有效期: ${tokens.expires_in} 秒 (${Math.floor(tokens.expires_in / 60)} 分钟)`);
    console.log('💡 提示: Access Token 过期后可以使用 refresh_token 自动刷新\n');
  } catch (error) {
    console.error('\n❌ 认证失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
