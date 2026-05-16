import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { logger } from '../logger.js';
import { LarkExecRequest, LarkExecResult, LarkExecutor } from './types.js';

const ALLOWED_TOP_LEVEL_COMMANDS = new Set([
  'docs',
  'task',
  'drive',
  'base',
  'contact',
  'im',
  'calendar',
  'wiki',
]);

const BLOCKED_TOP_LEVEL_COMMANDS = new Set([
  'config',
  'auth',
  'profile',
  'update',
  'service',
  'schema',
  'api',
  'event',
]);

const DEFAULT_TIMEOUT_MS = 30_000;

function defaultConfigDir(): string {
  return path.join(os.homedir(), '.config', 'nanoclaw', 'lark-cli');
}

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveFromPath(binaryName: string): string | null {
  const pathEnv = process.env.PATH;
  if (!pathEnv) return null;

  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binaryName);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveLarkCliBin(): string {
  const explicit = process.env.NANOCLAW_LARK_CLI_BIN;
  if (explicit && isExecutableFile(explicit)) {
    return explicit;
  }

  const vendored = path.join(
    process.cwd(),
    'vendor',
    'lark-cli',
    'bin',
    'lark-cli',
  );
  if (isExecutableFile(vendored)) {
    return vendored;
  }

  const fromPath = resolveFromPath('lark-cli');
  if (fromPath) {
    return fromPath;
  }

  throw new Error(
    'Unable to locate lark-cli binary. Set NANOCLAW_LARK_CLI_BIN or sync vendored assets first.',
  );
}

export function buildLarkCliEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LARKSUITE_CLI_CONFIG_DIR:
      process.env.NANOCLAW_LARK_CLI_CONFIG_DIR || defaultConfigDir(),
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
  };
}

export function validateLarkCliArgv(argv: string[]): void {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error('lark-cli argv must not be empty');
  }

  const [command] = argv;
  if (BLOCKED_TOP_LEVEL_COMMANDS.has(command)) {
    throw new Error(`lark-cli command "${command}" is not allowed`);
  }
  if (!ALLOWED_TOP_LEVEL_COMMANDS.has(command)) {
    throw new Error(`lark-cli command "${command}" is not in the allowlist`);
  }
}

function withJsonFormat(argv: string[], expectJson: boolean): string[] {
  if (!expectJson) return [...argv];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--format') {
      return [...argv];
    }
  }

  return [...argv, '--format', 'json'];
}

function parseJson(stdout: string): unknown | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed);
}

export class SpawnLarkExecutor implements LarkExecutor {
  async run(req: LarkExecRequest): Promise<LarkExecResult> {
    validateLarkCliArgv(req.argv);

    const binary = resolveLarkCliBin();
    const argv = withJsonFormat(req.argv, req.expectJson ?? true);
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    logger.debug(
      { binary, argv, timeoutMs },
      'Executing lark-cli via spawned process',
    );

    return await new Promise<LarkExecResult>((resolve, reject) => {
      const child = spawn(binary, argv, {
        cwd: req.cwd,
        env: buildLarkCliEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(
          new Error(
            `lark-cli timed out after ${timeoutMs}ms: ${argv.join(' ')}`,
          ),
        );
      }, timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        let json: unknown | undefined;
        if ((req.expectJson ?? true) && stdout.trim()) {
          try {
            json = parseJson(stdout);
          } catch (error) {
            logger.warn(
              {
                err: error instanceof Error ? error.message : String(error),
                stdout,
              },
              'Failed to parse lark-cli stdout as JSON',
            );
          }
        }

        resolve({
          ok: code === 0,
          exitCode: code ?? -1,
          stdout,
          stderr,
          json,
        });
      });
    });
  }
}
