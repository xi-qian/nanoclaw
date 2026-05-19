import { describe, expect, it } from 'vitest';

import {
  extractPath,
  interpolatePrompt,
  matchWebhookTask,
  parseQueryParams,
} from './webhook-tasks.js';
import type { WebhookTaskConfig } from './webhook-tasks.js';

describe('webhook-tasks', () => {
  describe('interpolatePrompt', () => {
    it('replaces placeholders with provided params', () => {
      expect(
        interpolatePrompt('请生成 {date} 的周报', { date: '2024-01-01' }),
      ).toBe('请生成 2024-01-01 的周报');
    });

    it('leaves unmatched placeholders as-is', () => {
      expect(interpolatePrompt('hello {name}', {})).toBe('hello {name}');
    });

    it('ignores extra params not in template', () => {
      expect(
        interpolatePrompt('hello {name}', { name: 'world', extra: 'val' }),
      ).toBe('hello world');
    });

    it('replaces multiple placeholders', () => {
      expect(interpolatePrompt('{a} and {b}', { a: '1', b: '2' })).toBe(
        '1 and 2',
      );
    });

    it('handles empty template', () => {
      expect(interpolatePrompt('', { a: '1' })).toBe('');
    });
  });

  describe('matchWebhookTask', () => {
    const tasks: WebhookTaskConfig[] = [
      { name: 'daily', path: '/webhook/task/daily', prompt: 'report' },
      { name: 'cleanup', path: '/webhook/task/cleanup', prompt: 'clean' },
    ];

    it('matches exact path', () => {
      expect(matchWebhookTask('/webhook/task/daily', tasks)?.name).toBe(
        'daily',
      );
    });

    it('returns undefined for no match', () => {
      expect(
        matchWebhookTask('/webhook/task/unknown', tasks),
      ).toBeUndefined();
    });

    it('returns undefined for empty tasks', () => {
      expect(matchWebhookTask('/webhook/task/daily', [])).toBeUndefined();
    });
  });

  describe('parseQueryParams', () => {
    it('parses single param', () => {
      expect(parseQueryParams('/path?date=2024-01-01')).toEqual({
        date: '2024-01-01',
      });
    });

    it('parses multiple params', () => {
      expect(parseQueryParams('/path?a=1&b=2')).toEqual({ a: '1', b: '2' });
    });

    it('returns empty for no query string', () => {
      expect(parseQueryParams('/path')).toEqual({});
    });

    it('decodes URL-encoded values', () => {
      expect(parseQueryParams('/path?q=hello%20world')).toEqual({
        q: 'hello world',
      });
    });
  });

  describe('extractPath', () => {
    it('returns path without query string', () => {
      expect(extractPath('/webhook/task/daily?date=2024-01-01')).toBe(
        '/webhook/task/daily',
      );
    });

    it('returns full URL when no query string', () => {
      expect(extractPath('/webhook/task/daily')).toBe('/webhook/task/daily');
    });
  });
});
