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
vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: class MockClient {
    im = {
      message: {
        create: vi.fn().mockResolvedValue({
          code: 0,
          data: { message_id: 'test_message_id' },
        }),
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

      const result = await client.uploadAndSendFile(
        'test_chat_id',
        '/test/path/file.pdf',
        'file',
      );

      expect(result.file_key).toBe('test_file_key');
      expect(result.message_id).toBe('test_message_id');
    });
  });
});
