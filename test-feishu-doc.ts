#!/usr/bin/env tsx
/**
 * 飞书文档创建测试脚本
 * 直接测试飞书 API 的 Markdown 转换功能
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { readFileSync } from 'fs';

// 读取实际的 Markdown 文件
const TEST_MARKDOWN_FILE = '/data/user/qianxi/nanoclaw/data/ipc/feishu-oc_d3e58c592ae925b1b0d59259f00712cf/downloads/项目周报-钱希-20260327.md';

// 读取文件内容
const TEST_MARKDOWN = readFileSync(TEST_MARKDOWN_FILE, 'utf-8');

console.log(`📄 测试文件: ${TEST_MARKDOWN_FILE}`);
console.log(`📝 文档大小: ${TEST_MARKDOWN.length} 字符`);
console.log(`📊 段落数: ${TEST_MARKDOWN.split('\n').length} 行`);
console.log();

async function testFeishuDoc() {
  console.log('🚀 开始测试飞书文档创建...\n');

  // 从环境变量或配置文件读取凭证
  const APP_ID = process.env.FEISHU_APP_ID || 'cli_a94bfb1a68781bc4';
  const APP_SECRET = process.env.FEISHU_APP_SECRET;

  if (!APP_SECRET) {
    console.error('❌ 请设置 FEISHU_APP_SECRET 环境变量');
    process.exit(1);
  }

  // 创建客户端
  const client = new Lark.Client({
    appId: APP_ID,
    appSecret: APP_SECRET,
    domain: Lark.Domain.Feishu,
  });

  try {
    // Step 1: 创建空文档
    console.log('📝 Step 1: 创建空文档...');
    const createResponse = await client.request({
      url: '/open-apis/docx/v1/documents',
      method: 'POST',
      data: {
        title: '🧪 测试文档 - Markdown 转换测试',
      },
    });

    if (createResponse.code !== 0) {
      throw new Error(`创建文档失败: ${createResponse.msg} (code: ${createResponse.code})`);
    }

    const documentId = createResponse.data?.document?.document_id;
    if (!documentId) {
      throw new Error('未返回 document_id');
    }

    console.log(`✅ 文档创建成功: ${documentId}`);
    console.log(`🔗 文档链接: https://feishu.cn/docx/${documentId}\n`);

    // Step 2: 调用转换 API
    console.log('🔄 Step 2: 调用 Markdown 转换 API...');
    const convertResponse = await client.request({
      url: '/open-apis/docx/v1/documents/blocks/convert',
      method: 'POST',
      data: {
        content_type: 'markdown',
        content: TEST_MARKDOWN,
      },
    });

    console.log(`转换 API 响应码: ${convertResponse.code}`);

    if (convertResponse.code !== 0) {
      console.error(`❌ 转换失败: ${convertResponse.msg}`);
      console.error(`错误数据:`, JSON.stringify(convertResponse.data, null, 2));
      return;
    }

    const blocks = convertResponse.data?.blocks;
    if (!blocks || blocks.length === 0) {
      console.error('❌ 转换成功但未返回任何块');
      return;
    }

    console.log(`✅ 转换成功，返回 ${blocks.length} 个块`);
    console.log(`📦 原始块类型统计:`);
    const originalBlockTypeCount: Record<number, number> = {};
    blocks.forEach((block: any) => {
      originalBlockTypeCount[block.block_type] = (originalBlockTypeCount[block.block_type] || 0) + 1;
    });
    console.log(JSON.stringify(originalBlockTypeCount, null, 2));
    console.log();

    // Step 3: 清理块数据
    console.log('🧹 Step 3: 清理块数据并过滤不支持的块...');
    const cleanedBlocks = blocks
      .filter((block: any) => {
        // 只保留最基本的块类型
        // block_type: 2=text, 3=heading1, 4=heading2, 5=heading3, 12=bullet, 13=ordered, 22=divider, 31=table
        // 先尝试只支持：2, 3, 4, 12, 22
        const supportedTypes = [2, 3, 4, 5, 12, 22];
        if (!supportedTypes.includes(block.block_type)) {
          console.log(`  过滤掉 block_type ${block.block_type}`);
          return false;
        }

        // 过滤掉表格单元格块（block_type 32）
        if (block.block_type === 32) {
          return false;
        }

        // 过滤掉有 children 字段的块（这些不是顶层块）
        if (block.children && Array.isArray(block.children) && block.children.length > 0) {
          console.log(`  过滤掉有 children 的块 ${block.block_id} (block_type ${block.block_type})`);
          return false;
        }

        return true;
      })
      .map((block: any) => {
        const cleaned = { ...block };

        // 移除空的 parent_id
        if (cleaned.parent_id === '') {
          delete cleaned.parent_id;
        }

        // 移除表格的 merge_info
        if (cleaned.block_type === 5 && cleaned.table?.merge_info) {
          delete cleaned.table.merge_info;
        }

        // 移除 children 字段（这些不是用于插入的子块）
        if (cleaned.children) {
          delete cleaned.children;
        }

        return cleaned;
      });

    console.log(`✅ 清理完成，剩余 ${cleanedBlocks.length} 个可插入块`);

    // 统计过滤后的块类型
    const blockTypeCount: Record<number, number> = {};
    cleanedBlocks.forEach((block: any) => {
      blockTypeCount[block.block_type] = (blockTypeCount[block.block_type] || 0) + 1;
    });
    console.log(`📦 过滤后块类型: ${JSON.stringify(blockTypeCount)}`);
    console.log();

    // Step 4: 插入块（分批，每批最多 50 个）
    console.log('➕ Step 4: 插入块到文档...');
    const BATCH_SIZE = 50;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < cleanedBlocks.length; i += BATCH_SIZE) {
      const batch = cleanedBlocks.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(cleanedBlocks.length / BATCH_SIZE);

      console.log(`  批次 ${batchNum}/${totalBatches}: ${batch.length} 个块...`);

      const insertResponse = await client.request({
        url: `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
        method: 'POST',
        data: {
          index: -1,
          children: batch,
        },
      });

      if (insertResponse.code !== 0) {
        console.error(`    ❌ 批次 ${batchNum} 失败: ${insertResponse.msg} (code: ${insertResponse.code})`);
        console.error(`    错误详情:`, JSON.stringify(insertResponse.data, null, 2));
        failCount++;
      } else {
        console.log(`    ✅ 批次 ${batchNum} 成功`);
        successCount++;
      }

      // 延迟避免速率限制
      if (i + BATCH_SIZE < cleanedBlocks.length) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    console.log();
    console.log('📊 测试结果:');
    console.log(`  成功批次: ${successCount}/${Math.ceil(cleanedBlocks.length / BATCH_SIZE)}`);
    console.log(`  失败批次: ${failCount}`);
    console.log();

    if (failCount === 0) {
      console.log('🎉 所有批次插入成功！');
      console.log(`🔗 查看文档: https://feishu.cn/docx/${documentId}`);
    } else {
      console.log('⚠️  部分批次失败，请查看上方错误信息');
    }

  } catch (error: any) {
    console.error('\n❌ 测试失败:');
    console.error(`错误类型: ${error.name}`);
    console.error(`错误消息: ${error.message}`);

    if (error.response?.data) {
      console.error(`API 响应:`, JSON.stringify(error.response.data, null, 2));
    }

    if (error.response?.status) {
      console.error(`HTTP 状态: ${error.response.status} ${error.response.statusText}`);
    }
  }
}

// 运行测试
testFeishuDoc().catch((error) => {
  console.error('未捕获的错误:', error);
  process.exit(1);
});
