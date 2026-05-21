import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isApprovalAllowed,
  loadApprovalAllowlist,
} from './approval-allowlist.js';

let tmpDir: string;

function cfgPath(name = 'approval-allowlist.json'): string {
  return path.join(tmpDir, name);
}

function writeConfig(config: unknown, name?: string): string {
  const p = cfgPath(name);
  fs.writeFileSync(p, JSON.stringify(config));
  return p;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-allowlist-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadApprovalAllowlist', () => {
  it('returns null when file is missing', () => {
    const cfg = loadApprovalAllowlist(cfgPath());
    expect(cfg).toBeNull();
  });

  it('returns null when file has invalid JSON', () => {
    const p = cfgPath();
    fs.writeFileSync(p, '{ not valid }}}');
    const cfg = loadApprovalAllowlist(p);
    expect(cfg).toBeNull();
  });

  it('returns null when default is missing', () => {
    const p = writeConfig({ groups: {} });
    const cfg = loadApprovalAllowlist(p);
    expect(cfg).toBeNull();
  });

  it('loads a valid config', () => {
    const p = writeConfig({
      default: { allow: false },
      groups: {
        'feishu-oc_xxx': {
          actions: ['approve', 'reject'],
          approval_codes: ['CODE-A'],
        },
      },
    });
    const cfg = loadApprovalAllowlist(p);
    expect(cfg).not.toBeNull();
    expect(cfg!.default.allow).toBe(false);
    expect(cfg!.groups['feishu-oc_xxx'].actions).toEqual(['approve', 'reject']);
    expect(cfg!.groups['feishu-oc_xxx'].approval_codes).toEqual(['CODE-A']);
  });

  it('skips invalid group entries', () => {
    const p = writeConfig({
      default: { allow: false },
      groups: {
        good: { actions: ['approve'], approval_codes: ['*'] },
        bad: { actions: 123 },
      },
    });
    const cfg = loadApprovalAllowlist(p);
    expect(cfg!.groups['good']).toBeDefined();
    expect(cfg!.groups['bad']).toBeUndefined();
  });
});

describe('isApprovalAllowed', () => {
  it('returns false when config is null', () => {
    expect(isApprovalAllowed(null, 'feishu-oc_xxx', 'approve')).toBe(false);
  });

  it('returns default.allow for unconfigured group', () => {
    const cfg = {
      default: { allow: true },
      groups: {},
    };
    expect(isApprovalAllowed(cfg, 'feishu-oc_xxx', 'approve')).toBe(true);
  });

  it('returns false when default.allow is false and group not in config', () => {
    const cfg = {
      default: { allow: false },
      groups: {},
    };
    expect(isApprovalAllowed(cfg, 'feishu-oc_xxx', 'approve')).toBe(false);
  });

  it('returns false when action is not in actions list', () => {
    const cfg = {
      default: { allow: false },
      groups: {
        'feishu-oc_xxx': {
          actions: ['comment'],
          approval_codes: ['*'],
        },
      },
    };
    expect(
      isApprovalAllowed(cfg, 'feishu-oc_xxx', 'approve', 'CODE-A'),
    ).toBe(false);
  });

  it('returns true when actions is wildcard', () => {
    const cfg = {
      default: { allow: false },
      groups: {
        'feishu-oc_xxx': {
          actions: ['*'],
          approval_codes: ['*'],
        },
      },
    };
    expect(
      isApprovalAllowed(cfg, 'feishu-oc_xxx', 'approve', 'CODE-A'),
    ).toBe(true);
  });

  it('returns false when approval_code does not match', () => {
    const cfg = {
      default: { allow: false },
      groups: {
        'feishu-oc_xxx': {
          actions: ['approve'],
          approval_codes: ['CODE-A'],
        },
      },
    };
    expect(
      isApprovalAllowed(cfg, 'feishu-oc_xxx', 'approve', 'CODE-B'),
    ).toBe(false);
  });

  it('returns true when action and approval_code both match', () => {
    const cfg = {
      default: { allow: false },
      groups: {
        'feishu-oc_xxx': {
          actions: ['approve', 'reject'],
          approval_codes: ['CODE-A', 'CODE-B'],
        },
      },
    };
    expect(
      isApprovalAllowed(cfg, 'feishu-oc_xxx', 'approve', 'CODE-A'),
    ).toBe(true);
    expect(
      isApprovalAllowed(cfg, 'feishu-oc_xxx', 'reject', 'CODE-B'),
    ).toBe(true);
  });

  it('returns true for get_instance without approval_code check', () => {
    const cfg = {
      default: { allow: false },
      groups: {
        'feishu-oc_xxx': {
          actions: ['get_instance'],
          approval_codes: ['CODE-A'],
        },
      },
    };
    expect(
      isApprovalAllowed(cfg, 'feishu-oc_xxx', 'get_instance'),
    ).toBe(true);
  });

  it('returns true for comment without approval_code check', () => {
    const cfg = {
      default: { allow: false },
      groups: {
        'feishu-oc_xxx': {
          actions: ['comment'],
          approval_codes: ['CODE-A'],
        },
      },
    };
    expect(
      isApprovalAllowed(cfg, 'feishu-oc_xxx', 'comment'),
    ).toBe(true);
  });

  it('returns true when action matches but no approval_code provided', () => {
    const cfg = {
      default: { allow: false },
      groups: {
        'feishu-oc_xxx': {
          actions: ['approve'],
          approval_codes: ['CODE-A'],
        },
      },
    };
    expect(
      isApprovalAllowed(cfg, 'feishu-oc_xxx', 'approve'),
    ).toBe(true);
  });

  it('approval_codes wildcard allows any code', () => {
    const cfg = {
      default: { allow: false },
      groups: {
        'feishu-oc_xxx': {
          actions: ['approve'],
          approval_codes: ['*'],
        },
      },
    };
    expect(
      isApprovalAllowed(cfg, 'feishu-oc_xxx', 'approve', 'ANY-CODE'),
    ).toBe(true);
  });
});
