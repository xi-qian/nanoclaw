import fs from 'fs';

import { APPROVAL_ALLOWLIST_PATH } from './config.js';
import { logger } from './logger.js';

export interface ApprovalGroupConfig {
  actions: string[];
  approval_codes: string[];
}

export interface ApprovalAllowlistConfig {
  default: { allow: boolean };
  groups: Record<string, ApprovalGroupConfig>;
}

function isValidGroupConfig(entry: unknown): entry is ApprovalGroupConfig {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  const validActions =
    Array.isArray(e.actions) && e.actions.every((v) => typeof v === 'string');
  const validCodes =
    Array.isArray(e.approval_codes) &&
    e.approval_codes.every((v) => typeof v === 'string');
  return validActions && validCodes;
}

export function loadApprovalAllowlist(
  pathOverride?: string,
): ApprovalAllowlistConfig | null {
  const filePath = pathOverride ?? APPROVAL_ALLOWLIST_PATH;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    logger.warn({ err, path: filePath }, 'approval-allowlist: cannot read');
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ path: filePath }, 'approval-allowlist: invalid JSON');
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  if (
    !obj.default ||
    typeof obj.default !== 'object' ||
    typeof (obj.default as Record<string, unknown>).allow !== 'boolean'
  ) {
    logger.warn(
      { path: filePath },
      'approval-allowlist: invalid or missing default',
    );
    return null;
  }

  const groups: Record<string, ApprovalGroupConfig> = {};
  if (obj.groups && typeof obj.groups === 'object') {
    for (const [key, entry] of Object.entries(
      obj.groups as Record<string, unknown>,
    )) {
      if (isValidGroupConfig(entry)) {
        groups[key] = entry;
      } else {
        logger.warn(
          { key, path: filePath },
          'approval-allowlist: skipping invalid group entry',
        );
      }
    }
  }

  return {
    default: obj.default as { allow: boolean },
    groups,
  };
}

export function isApprovalAllowed(
  cfg: ApprovalAllowlistConfig | null,
  sourceGroup: string,
  action: string,
  approvalCode?: string,
): boolean {
  if (!cfg) return false;

  const groupConfig = cfg.groups[sourceGroup];
  if (!groupConfig) return cfg.default.allow;

  const actionsMatch =
    groupConfig.actions.includes('*') || groupConfig.actions.includes(action);
  if (!actionsMatch) return false;

  if (approvalCode) {
    return (
      groupConfig.approval_codes.includes('*') ||
      groupConfig.approval_codes.includes(approvalCode)
    );
  }

  return true;
}
