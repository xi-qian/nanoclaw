import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { spawnMock, readEnvFileMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  readEnvFileMock: vi.fn(() => ({})),
}));
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => (spawnMock as any)(...args),
}));
vi.mock('../env.js', () => ({
  readEnvFile: (...args: any[]) => (readEnvFileMock as any)(...args),
}));

import {
  buildLarkCliEnv,
  resolveLarkCliBin,
  SpawnLarkExecutor,
  validateLarkCliArgv,
} from './spawn.js';

function createMockChild(
  exitCode = 0,
  stdout = '',
  stderr = '',
): EventEmitter & {
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.kill = vi.fn();

  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', stdout);
    if (stderr) child.stderr.emit('data', stderr);
    child.emit('close', exitCode);
  });

  return child;
}

describe('validateLarkCliArgv', () => {
  it('allows supported top-level commands', () => {
    expect(() => validateLarkCliArgv(['docs', '+fetch'])).not.toThrow();
  });

  it('rejects blocked commands', () => {
    expect(() => validateLarkCliArgv(['auth', 'status'])).toThrow(
      'lark-cli command "auth" is not allowed',
    );
  });

  it('rejects non-allowlisted commands', () => {
    expect(() => validateLarkCliArgv(['unknown'])).toThrow(
      'lark-cli command "unknown" is not in the allowlist',
    );
  });
});

describe('resolveLarkCliBin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    readEnvFileMock.mockReset();
    readEnvFileMock.mockReturnValue({});
  });

  it('uses explicit env override when executable', () => {
    vi.stubEnv('NANOCLAW_LARK_CLI_BIN', '/tmp/custom-lark-cli');
    vi.spyOn(fs, 'accessSync').mockImplementation((filePath) => {
      if (filePath === '/tmp/custom-lark-cli') return undefined;
      throw new Error('missing');
    });

    expect(resolveLarkCliBin()).toBe('/tmp/custom-lark-cli');
  });

  it('falls back to vendored binary when present', () => {
    vi.unstubAllEnvs();
    const vendored = path.join(
      process.cwd(),
      'vendor',
      'lark-cli',
      'bin',
      'lark-cli',
    );
    vi.spyOn(fs, 'accessSync').mockImplementation((filePath) => {
      if (filePath === vendored) return undefined;
      throw new Error('missing');
    });

    expect(resolveLarkCliBin()).toBe(vendored);
  });

  it('uses .env override when process env is absent', async () => {
    vi.unstubAllEnvs();
    readEnvFileMock.mockReturnValue({
      NANOCLAW_LARK_CLI_BIN: '/tmp/from-dotenv-lark-cli',
    });

    vi.resetModules();
    const { resolveLarkCliBin: resolveWithDotenv } = await import('./spawn.js');

    vi.spyOn(fs, 'accessSync').mockImplementation((filePath) => {
      if (filePath === '/tmp/from-dotenv-lark-cli') return undefined;
      throw new Error('missing');
    });

    expect(resolveWithDotenv()).toBe('/tmp/from-dotenv-lark-cli');
  });
});

describe('buildLarkCliEnv', () => {
  beforeEach(() => {
    readEnvFileMock.mockReset();
    readEnvFileMock.mockReturnValue({});
  });

  it('injects config dir and disables notices', () => {
    vi.stubEnv('NANOCLAW_LARK_CLI_CONFIG_DIR', '/tmp/lark-config');
    const env = buildLarkCliEnv();

    expect(env.LARKSUITE_CLI_CONFIG_DIR).toBe('/tmp/lark-config');
    expect(env.LARKSUITE_CLI_NO_UPDATE_NOTIFIER).toBe('1');
    expect(env.LARKSUITE_CLI_NO_SKILLS_NOTIFIER).toBe('1');
  });

  it('uses a default config dir when override is absent', () => {
    vi.unstubAllEnvs();
    const env = buildLarkCliEnv();

    expect(env.LARKSUITE_CLI_CONFIG_DIR).toBe(
      path.join(os.homedir(), '.config', 'nanoclaw', 'lark-cli'),
    );
  });

  it('uses .env config dir when process env is absent', async () => {
    vi.unstubAllEnvs();
    readEnvFileMock.mockReturnValue({
      NANOCLAW_LARK_CLI_CONFIG_DIR: '/tmp/lark-config-from-dotenv',
    });

    vi.resetModules();
    const { buildLarkCliEnv: buildWithDotenv } = await import('./spawn.js');
    const env = buildWithDotenv();

    expect(env.LARKSUITE_CLI_CONFIG_DIR).toBe('/tmp/lark-config-from-dotenv');
  });
});

describe('SpawnLarkExecutor', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    vi.stubEnv('NANOCLAW_LARK_CLI_BIN', '/tmp/custom-lark-cli');
    vi.spyOn(fs, 'accessSync').mockImplementation((filePath) => {
      if (filePath === '/tmp/custom-lark-cli') return undefined;
      throw new Error('missing');
    });
  });

  it('executes lark-cli, injects json format for non-shortcut commands, and parses JSON output', async () => {
    spawnMock.mockReturnValue(createMockChild(0, '{"ok":true}\n', ''));

    const executor = new SpawnLarkExecutor();
    const result = await executor.run({
      argv: ['docs', 'search', '--query', 'token'],
      expectJson: true,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      '/tmp/custom-lark-cli',
      ['docs', 'search', '--query', 'token', '--format', 'json'],
      expect.objectContaining({
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    expect(result).toEqual({
      ok: true,
      exitCode: 0,
      stdout: '{"ok":true}\n',
      stderr: '',
      json: { ok: true },
    });
  });

  it('does not add --format when already present', async () => {
    spawnMock.mockReturnValue(createMockChild(0, '{"ok":true}\n', ''));

    const executor = new SpawnLarkExecutor();
    await executor.run({
      argv: ['task', '+create', '--format', 'json'],
      expectJson: true,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      '/tmp/custom-lark-cli',
      ['task', '+create', '--format', 'json'],
      expect.any(Object),
    );
  });

  it('does not add --format for shortcut commands', async () => {
    spawnMock.mockReturnValue(createMockChild(0, '{"ok":true}\n', ''));

    const executor = new SpawnLarkExecutor();
    await executor.run({
      argv: ['docs', '+create', '--title', 'Test'],
      expectJson: true,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      '/tmp/custom-lark-cli',
      ['docs', '+create', '--title', 'Test'],
      expect.any(Object),
    );
  });

  it('returns stderr and non-zero exit codes without throwing', async () => {
    spawnMock.mockReturnValue(createMockChild(1, '', 'permission denied'));

    const executor = new SpawnLarkExecutor();
    const result = await executor.run({
      argv: ['docs', '+fetch', '--doc', 'token'],
      expectJson: true,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('permission denied');
  });

  it('parses JSON output even when expectJson is false', async () => {
    spawnMock.mockReturnValue(createMockChild(0, '{"ok":true}\n', ''));

    const executor = new SpawnLarkExecutor();
    const result = await executor.run({
      argv: ['docs', '+fetch', '--doc', 'token'],
      expectJson: false,
    });

    expect(result.json).toEqual({ ok: true });
  });

  it('rejects unsupported commands before spawning', async () => {
    const executor = new SpawnLarkExecutor();

    await expect(
      executor.run({
        argv: ['auth', 'status'],
      }),
    ).rejects.toThrow('lark-cli command "auth" is not allowed');
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
