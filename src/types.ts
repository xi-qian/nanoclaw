export interface AdditionalMount {
  hostPath: string; // Absolute path on host (supports ~ for home)
  containerPath?: string; // Optional — defaults to basename of hostPath. Mounted at /workspace/extra/{value}
  readonly?: boolean; // Default: true for safety
}

/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/nanoclaw/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
  // Directories that can be mounted into containers
  allowedRoots: AllowedRoot[];
  // Glob patterns for paths that should never be mounted (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // If true, non-main groups can only mount read-only regardless of config
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write mounts are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number; // Default: 300000 (5 minutes)
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
  requiresTrigger?: boolean; // Default: true for groups, false for solo chats
  isMain?: boolean; // True for the main control group (no trigger, elevated privileges)
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
  // 卡片动作相关字段
  card_action?: CardActionData;
  // 消息类型（用于区分文本、图片、文件等）
  message_type?:
    | 'text'
    | 'image'
    | 'file'
    | 'audio'
    | 'media'
    | 'post'
    | 'interactive';
  // 附件信息（图片、文件、音频、视频等）
  attachment?: MessageAttachment;
  // Request tracking (for sender verification)
  requestId?: string; // UUID linking to request_contexts table
}

/**
 * 消息附件信息
 */
export interface MessageAttachment {
  /** 资源类型 */
  type: 'image' | 'file' | 'audio' | 'video';
  /** 资源 key（用于下载） */
  key: string;
  /** 文件名（如果有） */
  name?: string;
  /** 文件大小（字节） */
  size?: number;
  /** MIME 类型 */
  mime_type?: string;
  /** 消息ID（用于下载用户发送的资源） */
  message_id?: string;
}

/**
 * 卡片动作数据（嵌入到 NewMessage 中）
 */
export interface CardActionData {
  /** 动作类型，如 button_click, select 等 */
  type: 'button_click' | 'select' | 'form_submit';
  /** 按钮或动作的自定义值 */
  value: Record<string, any>;
  /** 原始消息ID（卡片所在的消息） */
  source_message_id?: string;
  /** 静态列表选项值（如果有） */
  option?: string;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
  // Creator tracking (for scheduled task permission verification)
  created_by_sender_id?: string;
  created_by_sender_name?: string;
  created_by_request_id?: string;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

/**
 * Request context for tracking message origins
 */
export interface RequestContext {
  request_id: string; // UUID
  message_id: string; // Feishu message ID
  chat_jid: string; // Chat JID (feishu:oc_xxx)
  sender_open_id: string; // Sender's open_id
  sender_name?: string; // Sender's display name (cached)
  trigger_message?: string; // Trigger message content (for audit)
  created_at: string; // ISO timestamp
  expires_at: string; // ISO timestamp
}

/**
 * Current context shared with container via file
 */
export interface CurrentContext {
  source_request_id: string;
  message_id?: string;
  sender_open_id?: string;
  sender_name?: string;
  chat_jid: string;
  group_folder: string;
  timestamp: string; // ISO timestamp
}

// --- Channel abstraction ---

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  // Optional: typing indicator. Channels that support it implement it.
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  // Optional: sync group/chat names from the platform.
  syncGroups?(force: boolean): Promise<void>;
}

// Callback type that channels use to deliver inbound messages
export type OnInboundMessage = (chatJid: string, message: NewMessage) => void;

// Callback for chat metadata discovery.
// name is optional — channels that deliver names inline (Telegram) pass it here;
// channels that sync names separately (via syncGroups) omit it.
export type OnChatMetadata = (
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
) => void;
