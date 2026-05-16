#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';

function parseDotEnv(filePath) {
  const result = {};
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  } catch {}
  return result;
}

function parseArgs(argv) {
  const args = {
    credentialsDir: undefined,
    configDir: undefined,
    profileName: 'nanoclaw-bot',
    brand: 'feishu',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--credentials-dir') {
      args.credentialsDir = argv[++i];
    } else if (arg === '--config-dir') {
      args.configDir = argv[++i];
    } else if (arg === '--profile-name') {
      args.profileName = argv[++i];
    } else if (arg === '--brand') {
      args.brand = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Generate lark-cli config from NanoClaw Feishu credentials.

Usage:
  node scripts/generate-lark-cli-config.mjs [options]

Options:
  --credentials-dir <dir>  Directory containing credentials.json
  --config-dir <dir>       Output lark-cli config directory
  --profile-name <name>    lark-cli profile name (default: nanoclaw-bot)
  --brand <feishu|lark>    App brand (default: feishu)
  --help, -h               Show this help

Environment / .env fallback:
  NANOCLAW_FEISHU_CREDENTIALS_DIR
  NANOCLAW_LARK_CLI_CONFIG_DIR
`);
}

function resolveSettings() {
  const dotenv = parseDotEnv(path.join(process.cwd(), '.env'));
  const args = parseArgs(process.argv.slice(2));

  const credentialsDir =
    args.credentialsDir ||
    process.env.NANOCLAW_FEISHU_CREDENTIALS_DIR ||
    dotenv.NANOCLAW_FEISHU_CREDENTIALS_DIR ||
    path.join(process.cwd(), 'store', 'auth', 'feishu');

  const configDir =
    args.configDir ||
    process.env.NANOCLAW_LARK_CLI_CONFIG_DIR ||
    dotenv.NANOCLAW_LARK_CLI_CONFIG_DIR ||
    path.join(os.homedir(), '.config', 'nanoclaw', 'lark-cli');

  return {
    credentialsDir: path.resolve(credentialsDir),
    configDir: path.resolve(configDir),
    profileName: args.profileName,
    brand: args.brand,
  };
}

function readCredentials(credentialsDir) {
  const credentialsPath = path.join(credentialsDir, 'credentials.json');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Failed to read NanoClaw Feishu credentials at ${credentialsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed?.appId || !parsed?.appSecret) {
    throw new Error(
      `NanoClaw credentials file is missing appId/appSecret: ${credentialsPath}`,
    );
  }

  return {
    credentialsPath,
    appId: String(parsed.appId),
    appSecret: String(parsed.appSecret),
  };
}

function readExistingConfig(configPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!Array.isArray(parsed.apps)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeFileAtomic(filePath, content, mode) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, content, { mode });
  fs.renameSync(tempPath, filePath);
  fs.chmodSync(filePath, mode);
}

function generateConfig({
  configDir,
  profileName,
  brand,
  appId,
  appSecret,
}) {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });

  const secretPath = path.join(configDir, 'nanoclaw.app_secret');
  const configPath = path.join(configDir, 'config.json');
  writeFileAtomic(secretPath, `${appSecret.trim()}\n`, 0o600);

  const existingConfig = readExistingConfig(configPath);
  const apps = [...(existingConfig?.apps ?? [])];
  const nextApp = {
    ...(apps.find((app) => app.name === profileName) ?? {}),
    name: profileName,
    appId,
    appSecret: {
      source: 'file',
      id: secretPath,
    },
    brand,
    defaultAs: 'bot',
    users: [],
  };

  const existingIndex = apps.findIndex((app) => app.name === profileName);
  if (existingIndex >= 0) {
    apps[existingIndex] = nextApp;
  } else {
    apps.push(nextApp);
  }

  const nextConfig = {
    ...(existingConfig ?? {}),
    currentApp: profileName,
    apps,
  };

  writeFileAtomic(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 0o600);
  return { configPath, secretPath };
}

function main() {
  const settings = resolveSettings();
  if (!['feishu', 'lark'].includes(settings.brand)) {
    throw new Error(`Invalid --brand: ${settings.brand}`);
  }

  const credentials = readCredentials(settings.credentialsDir);
  const output = generateConfig({
    configDir: settings.configDir,
    profileName: settings.profileName,
    brand: settings.brand,
    appId: credentials.appId,
    appSecret: credentials.appSecret,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        profile: settings.profileName,
        brand: settings.brand,
        appId: credentials.appId,
        credentialsPath: credentials.credentialsPath,
        configDir: settings.configDir,
        configPath: output.configPath,
        secretPath: output.secretPath,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
