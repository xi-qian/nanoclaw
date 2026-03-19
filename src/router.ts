/**
 * Router
 *
 * 消息路由和格式化
 */

import type { Channel } from './types.js';

/**
 * 根据 JID 查找对应的通道
 */
export function findChannel(channels: Channel[], jid: string): Channel | undefined {
  return channels.find((ch) => ch.ownsJid(jid));
}

/**
 * 移除内部标签（用于隐藏思考过程等）
 */
export function stripInternalTags(text: string): string {
  // 移除单行和多行的 <internal>...</internal> 标签
  return text.replace(/<internal>[\s\S]*?<\/internal>/gi, '');
}

/**
 * 格式化消息列表为 XML（用于 Agent 提示词）
 */
export function formatMessages(messages: any[], timezone: string): string {
  const formattedMessages = messages
    .map((msg) => {
      const timestamp = new Date(msg.timestamp).toLocaleString('en-US', {
        timeZone: timezone,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      const sender = escapeXml(msg.sender_name || 'User');
      const content = escapeXml(msg.content);
      return `    <message sender="${sender}" timestamp="${timestamp}">${content}</message>`;
    })
    .join('\n');

  return `<context timezone="${timezone}" />\n<messages>\n${formattedMessages}\n</messages>`;
}

/**
 * 格式化出站消息（移除内部标签，可选添加前缀）
 */
export function formatOutbound(text: string, assistantName?: string): string {
  const stripped = stripInternalTags(text);
  if (assistantName) {
    return `${assistantName}: ${stripped}`;
  }
  return stripped;
}

/**
 * 转义 XML 特殊字符
 */
export function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
