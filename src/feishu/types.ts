/**
 * Feishu/Lark Types
 *
 * 飞书集成相关的类型定义
 */

/**
 * 飞书品牌
 */
export type LarkBrand = 'feishu' | 'lark';

/**
 * 飞书凭证类型（复制定义避免循环依赖）
 */
export interface FeishuCredentials {
  appId: string;
  appSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  tenantKey?: string;
}

/**
 * 飞书事件类型
 */
export interface FeishuEvent {
  type: string;
  event?: {
    operator?: {
      open_id: string;
    };
    sender?: {
      sender_id: {
        open_id: string;
        union_id?: string;
        user_id?: string | null;
      };
      sender_type: string;
      tenant_key: string;
    };
    message?: {
      message_id: string;
      chat_id: string;
      chat_type: string;
      content: string; // JSON 字符串
      create_time: string;
      updated_time?: string;
      sender?: {
        sender_id: {
          open_id: string;
        };
      };
    };
    reaction?: {
      emoji: {
        emoji_type: string;
        emoji_alias: string;
      };
      message_id: string;
      chat_id: string;
      operator: {
        open_id: string;
      };
    };
    // 卡片回调事件
    action?: {
      open_id: string;
      token: string;
      action_time: string;
      value?: Record<string, any>; // 按钮自定义值
      option?: string; // 静态列表选择值
    };
    // 卡片上下文信息
    context?: {
      open_message_id: string;
      open_chat_id: string;
    };
  };
}

/**
 * 飞书消息内容
 */
export interface FeishuMessageContent {
  text?: string;
  post?: FeishuPostContent;
  [key: string]: any;
}

/**
 * 飞书富文本内容
 */
export interface FeishuPostContent {
  zh_cn?: FeishuPostElement[][];
  en_us?: FeishuPostElement[][];
}

/**
 * 富文本元素
 */
export interface FeishuPostElement {
  tag: string;
  text?: string;
  href?: string;
  [key: string]: any;
}

/**
 * 文档信息
 */
export interface FeishuDocInfo {
  doc_id: string;
  title: string;
  content?: string;
  url?: string;
  has_more?: boolean;
}

/**
 * 文档创建选项
 */
export interface CreateDocOptions {
  folder_token?: string;
  wiki_node?: string;
  wiki_space_id?: string;
}

/**
 * 文档搜索结果
 */
export interface FeishuDocSearchResult {
  title: string;
  doc_id: string;
  url: string;
  snippet?: string;
}
