#!/usr/bin/env npx ts-node
/**
 * sendToUser 功能测试脚本
 *
 * 使用方法：
 * 1. 设置环境变量：
 *    export FEISHU_APP_ID="your_app_id"
 *    export FEISHU_APP_SECRET="your_app_secret"
 *    export TEST_USER_OPEN_ID="ou_xxx"  # 测试用户的 open_id
 *    # 或者使用邮箱：
 *    export TEST_USER_EMAIL="user@example.com"
 *
 * 2. 运行测试：
 *    npx ts-node scripts/test-send-to-user.ts
 */

import { FeishuClient } from '../src/feishu/client.js';

async function main() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const testUserOpenId = process.env.TEST_USER_OPEN_ID;
  const testUserEmail = process.env.TEST_USER_EMAIL;
  const testUserName = process.env.TEST_USER_NAME || '测试用户';

  if (!appId || !appSecret) {
    console.error('❌ 请设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET 环境变量');
    process.exit(1);
  }

  if (!testUserOpenId && !testUserEmail) {
    console.error('❌ 请设置 TEST_USER_OPEN_ID 或 TEST_USER_EMAIL 环境变量');
    process.exit(1);
  }

  console.log('🔧 初始化飞书客户端...');
  const client = new FeishuClient({ appId, appSecret }, 'feishu');

  console.log('\n📋 测试场景 1: 使用 open_id 发送消息');
  if (testUserOpenId) {
    try {
      const result = await client.sendToUser(
        testUserOpenId,
        'open_id',
        `**测试消息 (open_id)**\n\n这是一条通过 sendToUser 发送的测试消息。\n\n发送时间: ${new Date().toLocaleString('zh-CN')}\n\n> 支持 Markdown 格式`,
        'post',
      );
      console.log('✅ 发送成功!');
      console.log(`   消息 ID: ${result.message_id}`);
      console.log(`   聊天 ID: ${result.chat_id || '未返回'}`);
    } catch (error) {
      console.error('❌ 发送失败:', error instanceof Error ? error.message : String(error));
    }
  } else {
    console.log('⏭️  跳过（未设置 TEST_USER_OPEN_ID）');
  }

  console.log('\n📋 测试场景 2: 使用 email 发送消息');
  if (testUserEmail) {
    try {
      const result = await client.sendToUser(
        testUserEmail,
        'email',
        `测试消息 (email) - 发送时间: ${new Date().toLocaleString('zh-CN')}`,
        'text',
      );
      console.log('✅ 发送成功!');
      console.log(`   消息 ID: ${result.message_id}`);
      console.log(`   聊天 ID: ${result.chat_id || '未返回'}`);
    } catch (error) {
      console.error('❌ 发送失败:', error instanceof Error ? error.message : String(error));
    }
  } else {
    console.log('⏭️  跳过（未设置 TEST_USER_EMAIL）');
  }

  console.log('\n📋 测试场景 3: 测试无效 open_id 错误处理');
  try {
    await client.sendToUser('ou_invalid_user_id', 'open_id', '这条消息不应该发送成功');
    console.error('❌ 预期失败但成功了');
  } catch (error) {
    console.log('✅ 正确抛出错误:', error instanceof Error ? error.message : String(error));
  }

  console.log('\n📋 测试场景 4: 测试无效 identify_type 错误处理');
  // 这个测试在 IPC 层进行验证，这里只测试 API 层

  console.log('\n✨ 测试完成!');
}

main().catch((error) => {
  console.error('❌ 测试脚本执行失败:', error);
  process.exit(1);
});