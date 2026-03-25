/**
 * Feishu Permission Verification
 * Checks if a user has access to specific Feishu resources
 */

import type { FeishuClient } from './client.js';

export interface PermissionResult {
  authorized: boolean;
  reason?: string;
}

/**
 * Verify if a user has access to a chat
 */
export async function verifyChatAccess(
  client: FeishuClient,
  senderOpenId: string,
  chatId: string,
): Promise<PermissionResult> {
  try {
    // Get chat members and check if sender is in the list
    const members = await client.getChatMembers(chatId);

    if (!members || !Array.isArray(members)) {
      // If we can't get members (e.g., bot not in chat), allow access
      // This is a safe default - the operation may still fail at the API level
      return { authorized: true };
    }

    const isMember = members.some(
      (member: any) =>
        member.member_id === senderOpenId || member.open_id === senderOpenId,
    );

    if (isMember) {
      return { authorized: true };
    }

    return {
      authorized: false,
      reason: `User ${senderOpenId} is not a member of chat ${chatId}`,
    };
  } catch (error) {
    // On error, allow access (fail-open for availability)
    // The actual API call will fail if truly unauthorized
    return { authorized: true };
  }
}

/**
 * Verify if a user has access to a document
 */
export async function verifyDocAccess(
  client: FeishuClient,
  senderOpenId: string,
  docId: string,
  permission: 'read' | 'edit',
): Promise<PermissionResult> {
  try {
    // Get document permission members
    const members = await client.getDocPermissionMembers(docId);

    if (!members || !Array.isArray(members)) {
      // If we can't get permissions, allow access
      return { authorized: true };
    }

    const userPermission = members.find(
      (member: any) =>
        member.member_id === senderOpenId ||
        member.member_id?.open_id === senderOpenId,
    );

    if (!userPermission) {
      return {
        authorized: false,
        reason: `User ${senderOpenId} does not have access to document ${docId}`,
      };
    }

    // Check permission level
    if (permission === 'edit' && userPermission.perm === 'view') {
      return {
        authorized: false,
        reason: `User ${senderOpenId} only has view access to document ${docId}`,
      };
    }

    return { authorized: true };
  } catch (error) {
    // On error, allow access (fail-open for availability)
    return { authorized: true };
  }
}

/**
 * Verify if a user has access to a folder
 */
export async function verifyFolderAccess(
  client: FeishuClient,
  senderOpenId: string,
  folderToken: string,
  permission: 'read' | 'edit',
): Promise<PermissionResult> {
  try {
    // Get folder permission members
    const members = await client.getFolderPermissionMembers(folderToken);

    if (!members || !Array.isArray(members)) {
      // If we can't get permissions, allow access
      return { authorized: true };
    }

    const userPermission = members.find(
      (member: any) =>
        member.member_id === senderOpenId ||
        member.member_id?.open_id === senderOpenId,
    );

    if (!userPermission) {
      return {
        authorized: false,
        reason: `User ${senderOpenId} does not have access to folder ${folderToken}`,
      };
    }

    // Check permission level
    if (permission === 'edit' && userPermission.perm === 'view') {
      return {
        authorized: false,
        reason: `User ${senderOpenId} only has view access to folder ${folderToken}`,
      };
    }

    return { authorized: true };
  } catch (error) {
    // On error, allow access (fail-open for availability)
    return { authorized: true };
  }
}
