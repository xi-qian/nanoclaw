import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => Buffer.from('test file content')),
}));

// Mock form-data module
vi.mock('form-data', () => ({
  default: class FormData {
    private data: Map<string, any> = new Map();
    append(key: string, value: any) {
      this.data.set(key, value);
    }
    getHeaders() {
      return { 'Content-Type': 'multipart/form-data' };
    }
    getLengthSync() {
      return 100; // Mock length
    }
    getBuffer() {
      return Buffer.from('mock form data');
    }
  },
}));

// Mock @larksuiteoapi/node-sdk
const mockMessageCreate = vi.fn();
vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: class MockClient {
    im = {
      message: {
        create: mockMessageCreate,
      },
    };
    request = vi.fn();
  },
  WSClient: class MockWSClient {
    start = vi.fn();
    close = vi.fn();
  },
  EventDispatcher: class MockEventDispatcher {
    register = vi.fn().mockReturnThis();
  },
  Domain: {
    Feishu: 'feishu',
    Lark: 'lark',
  },
  LoggerLevel: {
    debug: 'debug',
  },
}));

import { FeishuClient } from './client.js';

// Reference to the mock request function injected by the MockClient
const mockRequest = vi.fn();

describe('FeishuClient', () => {
  let client: FeishuClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new FeishuClient(
      { appId: 'test_app_id', appSecret: 'test_app_secret' },
      'feishu',
    );
    // Bind mockRequest to the client's internal Lark Client.request
    (client as any).client.request = mockRequest;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('uploadFile', () => {
    it('should upload file and return file_key', async () => {
      // Mock tenant access token response
      mockFetch
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({
              code: 0,
              tenant_access_token: 'test_tenant_token',
            }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                tenant_access_token: 'test_tenant_token',
              }),
            ),
          status: 200,
        })
        // Mock file upload response
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({
              code: 0,
              data: { file_key: 'test_file_key' },
            }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: { file_key: 'test_file_key' },
              }),
            ),
          status: 200,
        });

      const fileKey = await client.uploadFile('/test/path/file.pdf', 'file');

      expect(fileKey).toBe('test_file_key');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error when upload fails', async () => {
      // Mock tenant access token response
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            code: 0,
            tenant_access_token: 'test_tenant_token',
          }),
        text: () =>
          Promise.resolve(
            JSON.stringify({
              code: 0,
              tenant_access_token: 'test_tenant_token',
            }),
          ),
        status: 200,
      });

      // Mock failed upload response
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            code: 99991663,
            msg: 'file size exceeds limit',
          }),
        text: () =>
          Promise.resolve(
            JSON.stringify({
              code: 99991663,
              msg: 'file size exceeds limit',
            }),
          ),
        status: 200,
      });

      await expect(
        client.uploadFile('/test/path/large_file.pdf', 'file'),
      ).rejects.toThrow('Failed to upload file: file size exceeds limit');
    });
  });

  describe('sendFileMessage', () => {
    it('should send file message successfully', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        code: 0,
        data: { message_id: 'test_message_id' },
      });

      const messageId = await client.sendFileMessage(
        'test_chat_id',
        'test_file_key',
        'test.pdf',
      );

      expect(messageId).toBe('test_message_id');
    });
  });

  describe('uploadAndSendFile', () => {
    it('should upload and send file in one call', async () => {
      // Mock tenant access token response
      mockFetch
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({
              code: 0,
              tenant_access_token: 'test_tenant_token',
            }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                tenant_access_token: 'test_tenant_token',
              }),
            ),
          status: 200,
        })
        // Mock file upload response
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({
              code: 0,
              data: { file_key: 'test_file_key' },
            }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 0,
                data: { file_key: 'test_file_key' },
              }),
            ),
          status: 200,
        });

      mockMessageCreate.mockResolvedValueOnce({
        code: 0,
        data: { message_id: 'test_message_id' },
      });

      const result = await client.uploadAndSendFile(
        'test_chat_id',
        '/test/path/file.pdf',
        'file',
      );

      expect(result.file_key).toBe('test_file_key');
      expect(result.message_id).toBe('test_message_id');
    });
  });

  describe('sendToUser', () => {
    it('should send message to user by open_id with post type', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        code: 0,
        data: {
          message_id: 'test_message_id',
          chat_id: 'oc_test_chat',
        },
      });

      const result = await client.sendToUser(
        'ou_test_user',
        'open_id',
        'Hello, this is a test message',
        'post',
      );

      expect(result.message_id).toBe('test_message_id');
      expect(result.chat_id).toBe('oc_test_chat');

      // Verify the call was made with correct parameters
      expect(mockMessageCreate).toHaveBeenCalledWith({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: 'ou_test_user',
          msg_type: 'post',
          content: expect.stringContaining('Hello, this is a test message'),
        },
      });
    });

    it('should send message to user by email with text type', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        code: 0,
        data: {
          message_id: 'test_message_id',
          chat_id: 'oc_test_chat',
        },
      });

      const result = await client.sendToUser(
        'user@example.com',
        'email',
        'Plain text message',
        'text',
      );

      expect(result.message_id).toBe('test_message_id');
      expect(result.chat_id).toBe('oc_test_chat');

      // Verify the call was made with correct parameters
      expect(mockMessageCreate).toHaveBeenCalledWith({
        params: { receive_id_type: 'email' },
        data: {
          receive_id: 'user@example.com',
          msg_type: 'text',
          content: expect.stringContaining('Plain text message'),
        },
      });
    });

    it('should default to post type when msg_type not specified', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        code: 0,
        data: { message_id: 'test_message_id' },
      });

      await client.sendToUser('ou_test_user', 'open_id', 'Test');

      const callArgs = mockMessageCreate.mock.calls[0][0];
      expect(callArgs.data.msg_type).toBe('post');
    });

    it('should throw error when send fails', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        code: 99991661,
        msg: 'user not found',
      });

      await expect(
        client.sendToUser('ou_invalid', 'open_id', 'Test message'),
      ).rejects.toThrow('发送失败: user not found');
    });

    it('should handle missing chat_id in response', async () => {
      mockMessageCreate.mockResolvedValueOnce({
        code: 0,
        data: { message_id: 'test_message_id' },
      });

      const result = await client.sendToUser('ou_test_user', 'open_id', 'Test');

      expect(result.message_id).toBe('test_message_id');
      expect(result.chat_id).toBeUndefined();
    });
  });

  // ==================== Drive Permission Operations ====================

  describe('addCollaborator', () => {
    it('should add a user collaborator successfully', async () => {
      mockRequest.mockResolvedValueOnce({
        code: 0,
        data: { member: { member_id: 'ou_test', perm: 'edit' } },
      });

      const result = await client.addCollaborator(
        'test_token',
        'bitable',
        'openid',
        'ou_test',
        'edit',
        'user',
      );

      expect(result).toEqual({ member_id: 'ou_test', perm: 'edit' });
      expect(mockRequest).toHaveBeenCalledWith({
        url: '/open-apis/drive/v1/permissions/test_token/members',
        method: 'POST',
        params: { type: 'bitable' },
        data: {
          member_type: 'openid',
          member_id: 'ou_test',
          perm: 'edit',
          type: 'user',
        },
      });
    });

    it('should add a chat collaborator', async () => {
      mockRequest.mockResolvedValueOnce({
        code: 0,
        data: { member: { member_id: 'oc_chat', perm: 'full_access' } },
      });

      const result = await client.addCollaborator(
        'test_token',
        'docx',
        'openchat',
        'oc_chat',
        'full_access',
        'chat',
      );

      expect(result).toEqual({ member_id: 'oc_chat', perm: 'full_access' });
    });

    it('should throw on API error', async () => {
      mockRequest.mockResolvedValueOnce({
        code: 99991663,
        msg: 'no permission',
      });

      await expect(
        client.addCollaborator(
          'test_token',
          'docx',
          'openid',
          'ou_test',
          'edit',
          'user',
        ),
      ).rejects.toThrow('Failed to add collaborator: no permission');
    });
  });

  describe('updateCollaborator', () => {
    it('should update collaborator permission', async () => {
      mockRequest.mockResolvedValueOnce({
        code: 0,
        data: { member: { member_id: 'ou_test', perm: 'view' } },
      });

      const result = await client.updateCollaborator(
        'test_token',
        'bitable',
        'ou_test',
        'view',
      );

      expect(result).toEqual({ member_id: 'ou_test', perm: 'view' });
      expect(mockRequest).toHaveBeenCalledWith({
        url: '/open-apis/drive/v1/permissions/test_token/members/ou_test',
        method: 'PUT',
        params: { type: 'bitable' },
        data: { perm: 'view' },
      });
    });

    it('should throw on API error', async () => {
      mockRequest.mockResolvedValueOnce({ code: 99991663, msg: 'forbidden' });

      await expect(
        client.updateCollaborator('test_token', 'docx', 'ou_test', 'edit'),
      ).rejects.toThrow('Failed to update collaborator: forbidden');
    });
  });

  describe('listCollaborators', () => {
    it('should list collaborators', async () => {
      const members = [
        { member_id: 'ou_user1', perm: 'full_access', type: 'user' },
        { member_id: 'oc_chat1', perm: 'edit', type: 'chat' },
      ];
      mockRequest.mockResolvedValueOnce({ code: 0, data: { members } });

      const result = await client.listCollaborators('test_token', 'docx');

      expect(result).toEqual(members);
      expect(mockRequest).toHaveBeenCalledWith({
        url: '/open-apis/drive/v1/permissions/test_token/members',
        method: 'GET',
        params: { type: 'docx' },
      });
    });

    it('should return empty array when no members', async () => {
      mockRequest.mockResolvedValueOnce({ code: 0, data: {} });

      const result = await client.listCollaborators('test_token', 'bitable');

      expect(result).toEqual([]);
    });
  });

  describe('removeCollaborator', () => {
    it('should remove collaborator successfully', async () => {
      mockRequest.mockResolvedValueOnce({ code: 0 });

      await client.removeCollaborator('test_token', 'docx', 'ou_test');

      expect(mockRequest).toHaveBeenCalledWith({
        url: '/open-apis/drive/v1/permissions/test_token/members/ou_test',
        method: 'DELETE',
        params: { type: 'docx' },
      });
    });

    it('should throw on API error', async () => {
      mockRequest.mockResolvedValueOnce({
        code: 99991663,
        msg: 'no permission',
      });

      await expect(
        client.removeCollaborator('test_token', 'docx', 'ou_test'),
      ).rejects.toThrow('Failed to remove collaborator: no permission');
    });
  });

  describe('transferOwner', () => {
    it('should transfer owner with default options', async () => {
      mockRequest.mockResolvedValueOnce({
        code: 0,
        data: { success: true },
      });

      const result = await client.transferOwner(
        'test_token',
        'bitable',
        'openid',
        'ou_new_owner',
      );

      expect(result).toEqual({ success: true });
      expect(mockRequest).toHaveBeenCalledWith({
        url: '/open-apis/drive/v1/permissions/test_token/members/transfer_owner',
        method: 'POST',
        params: { type: 'bitable', remove_old_owner: 'false' },
        data: { member_type: 'openid', member_id: 'ou_new_owner' },
      });
    });

    it('should transfer owner with remove_old_owner and old_owner_perm', async () => {
      mockRequest.mockResolvedValueOnce({ code: 0, data: {} });

      await client.transferOwner(
        'test_token',
        'docx',
        'openid',
        'ou_new_owner',
        true,
        'edit',
      );

      expect(mockRequest).toHaveBeenCalledWith({
        url: '/open-apis/drive/v1/permissions/test_token/members/transfer_owner',
        method: 'POST',
        params: { type: 'docx', remove_old_owner: 'true' },
        data: { member_type: 'openid', member_id: 'ou_new_owner' },
      });
    });

    it('should include old_owner_perm when remove_old_owner is false', async () => {
      mockRequest.mockResolvedValueOnce({ code: 0, data: {} });

      await client.transferOwner(
        'test_token',
        'bitable',
        'openid',
        'ou_new',
        false,
        'view',
      );

      expect(mockRequest).toHaveBeenCalledWith({
        url: '/open-apis/drive/v1/permissions/test_token/members/transfer_owner',
        method: 'POST',
        params: {
          type: 'bitable',
          remove_old_owner: 'false',
          old_owner_perm: 'view',
        },
        data: { member_type: 'openid', member_id: 'ou_new' },
      });
    });

    it('should throw on API error', async () => {
      mockRequest.mockResolvedValueOnce({
        code: 99991663,
        msg: 'no permission',
      });

      await expect(
        client.transferOwner('test_token', 'docx', 'openid', 'ou_new'),
      ).rejects.toThrow('Failed to transfer owner: no permission');
    });
  });
});
