import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
  CardActionData,
} from '../types.js';

export interface ChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  /** 卡片动作回调，当用户点击卡片按钮时触发 */
  onCardAction?: (
    chatJid: string,
    action: CardActionData,
    sender: string,
  ) => void;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export type ChannelFactory = (opts: ChannelOpts) => Channel | null;

// Re-export Channel type for use in channel implementations
export type { Channel };

const registry = new Map<string, ChannelFactory>();

export function registerChannel(name: string, factory: ChannelFactory): void {
  registry.set(name, factory);
}

export function getChannelFactory(name: string): ChannelFactory | undefined {
  return registry.get(name);
}

export function getRegisteredChannelNames(): string[] {
  return [...registry.keys()];
}
