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

describe('FeishuClient', () => {
  let client: FeishuClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new FeishuClient(
      { appId: 'test_app_id', appSecret: 'test_app_secret' },
      'feishu',
    );
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
});
