import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  verifyChatAccess,
  verifyDocAccess,
  verifyFolderAccess,
} from './permission.js';

describe('permission verification', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      getChatMembers: vi.fn(),
      getDocPermissionMembers: vi.fn(),
      getFolderPermissionMembers: vi.fn(),
    };
  });

  describe('verifyChatAccess', () => {
    it('authorizes when user is in chat members', async () => {
      mockClient.getChatMembers.mockResolvedValue([
        { member_id: 'ou_alice', open_id: 'ou_alice' },
        { member_id: 'ou_bob', open_id: 'ou_bob' },
      ]);

      const result = await verifyChatAccess(
        mockClient,
        'ou_alice',
        'oc_chat123',
      );
      expect(result.authorized).toBe(true);
    });

    it('denies when user is not in chat members', async () => {
      mockClient.getChatMembers.mockResolvedValue([
        { member_id: 'ou_alice', open_id: 'ou_alice' },
      ]);

      const result = await verifyChatAccess(mockClient, 'ou_bob', 'oc_chat123');
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain('not a member');
    });

    it('allows when members list is unavailable', async () => {
      mockClient.getChatMembers.mockResolvedValue(null);

      const result = await verifyChatAccess(
        mockClient,
        'ou_alice',
        'oc_chat123',
      );
      expect(result.authorized).toBe(true);
    });

    it('allows on API error (fail-open)', async () => {
      mockClient.getChatMembers.mockRejectedValue(new Error('API error'));

      const result = await verifyChatAccess(
        mockClient,
        'ou_alice',
        'oc_chat123',
      );
      expect(result.authorized).toBe(true);
    });
  });

  describe('verifyDocAccess', () => {
    it('authorizes read when user has view permission', async () => {
      mockClient.getDocPermissionMembers.mockResolvedValue([
        { member_id: 'ou_alice', perm: 'view' },
      ]);

      const result = await verifyDocAccess(
        mockClient,
        'ou_alice',
        'doc123',
        'read',
      );
      expect(result.authorized).toBe(true);
    });

    it('denies edit when user only has view permission', async () => {
      mockClient.getDocPermissionMembers.mockResolvedValue([
        { member_id: 'ou_alice', perm: 'view' },
      ]);

      const result = await verifyDocAccess(
        mockClient,
        'ou_alice',
        'doc123',
        'edit',
      );
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain('only has view access');
    });

    it('authorizes edit when user has edit permission', async () => {
      mockClient.getDocPermissionMembers.mockResolvedValue([
        { member_id: 'ou_alice', perm: 'edit' },
      ]);

      const result = await verifyDocAccess(
        mockClient,
        'ou_alice',
        'doc123',
        'edit',
      );
      expect(result.authorized).toBe(true);
    });

    it('denies when user does not have access', async () => {
      mockClient.getDocPermissionMembers.mockResolvedValue([
        { member_id: 'ou_bob', perm: 'edit' },
      ]);

      const result = await verifyDocAccess(
        mockClient,
        'ou_alice',
        'doc123',
        'read',
      );
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain('does not have access');
    });

    it('allows when permission list is unavailable', async () => {
      mockClient.getDocPermissionMembers.mockResolvedValue(null);

      const result = await verifyDocAccess(
        mockClient,
        'ou_alice',
        'doc123',
        'read',
      );
      expect(result.authorized).toBe(true);
    });

    it('allows on API error (fail-open)', async () => {
      mockClient.getDocPermissionMembers.mockRejectedValue(
        new Error('API error'),
      );

      const result = await verifyDocAccess(
        mockClient,
        'ou_alice',
        'doc123',
        'edit',
      );
      expect(result.authorized).toBe(true);
    });
  });

  describe('verifyFolderAccess', () => {
    it('authorizes read when user has view permission', async () => {
      mockClient.getFolderPermissionMembers.mockResolvedValue([
        { member_id: 'ou_alice', perm: 'view' },
      ]);

      const result = await verifyFolderAccess(
        mockClient,
        'ou_alice',
        'folder123',
        'read',
      );
      expect(result.authorized).toBe(true);
    });

    it('denies edit when user only has view permission', async () => {
      mockClient.getFolderPermissionMembers.mockResolvedValue([
        { member_id: 'ou_alice', perm: 'view' },
      ]);

      const result = await verifyFolderAccess(
        mockClient,
        'ou_alice',
        'folder123',
        'edit',
      );
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain('only has view access');
    });

    it('authorizes edit when user has edit permission', async () => {
      mockClient.getFolderPermissionMembers.mockResolvedValue([
        { member_id: 'ou_alice', perm: 'edit' },
      ]);

      const result = await verifyFolderAccess(
        mockClient,
        'ou_alice',
        'folder123',
        'edit',
      );
      expect(result.authorized).toBe(true);
    });

    it('denies when user does not have access', async () => {
      mockClient.getFolderPermissionMembers.mockResolvedValue([
        { member_id: 'ou_bob', perm: 'edit' },
      ]);

      const result = await verifyFolderAccess(
        mockClient,
        'ou_alice',
        'folder123',
        'read',
      );
      expect(result.authorized).toBe(false);
      expect(result.reason).toContain('does not have access');
    });

    it('allows when permission list is unavailable', async () => {
      mockClient.getFolderPermissionMembers.mockResolvedValue(null);

      const result = await verifyFolderAccess(
        mockClient,
        'ou_alice',
        'folder123',
        'read',
      );
      expect(result.authorized).toBe(true);
    });

    it('allows on API error (fail-open)', async () => {
      mockClient.getFolderPermissionMembers.mockRejectedValue(
        new Error('API error'),
      );

      const result = await verifyFolderAccess(
        mockClient,
        'ou_alice',
        'folder123',
        'edit',
      );
      expect(result.authorized).toBe(true);
    });
  });
});
