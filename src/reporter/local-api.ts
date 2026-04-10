import fs from 'fs';
import path from 'path';
import { GROUPS_DIR, DATA_DIR } from '../config.js';
import { logger } from '../logger.js';
import { SkillInfo, MemoryFile, GroupInfo } from './types.js';

// Get all groups
export function getAllGroups(): GroupInfo[] {
  const groups: GroupInfo[] = [];

  // Read from database or memory - for now, return empty
  // This will be called from index.ts with actual data
  return groups;
}

// Get skills for a group
export function getGroupSkills(groupFolder: string): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const groupDir = resolveGroupFolderPath(groupFolder);
  const skillsDir = path.join(
    DATA_DIR,
    'sessions',
    groupFolder,
    '.claude',
    'skills'
  );

  if (!fs.existsSync(skillsDir)) {
    return skills;
  }

  for (const skillDir of fs.readdirSync(skillsDir)) {
    const skillPath = path.join(skillsDir, skillDir, 'SKILL.md');
    if (fs.existsSync(skillPath)) {
      skills.push({
        name: skillDir,
        path: skillPath,
        content: fs.readFileSync(skillPath, 'utf-8'),
      });
    }
  }

  return skills;
}

// Get memory files for a group
export function getGroupMemory(groupFolder: string): MemoryFile[] {
  const memory: MemoryFile[] = [];
  const groupDir = resolveGroupFolderPath(groupFolder);
  const memoryDir = groupDir; // Memory files are in group root

  // Look for common memory files
  const memoryFiles = ['CLAUDE.md', 'MEMORY.md', 'memory.md'];

  for (const filename of memoryFiles) {
    const filePath = path.join(memoryDir, filename);
    if (fs.existsSync(filePath)) {
      memory.push({
        name: filename,
        path: filePath,
        content: fs.readFileSync(filePath, 'utf-8'),
      });
    }
  }

  // Also check for additional .md files
  if (fs.existsSync(memoryDir)) {
    for (const file of fs.readdirSync(memoryDir)) {
      if (file.endsWith('.md') && !memoryFiles.includes(file)) {
        const filePath = path.join(memoryDir, file);
        memory.push({
          name: file,
          path: filePath,
          content: fs.readFileSync(filePath, 'utf-8'),
        });
      }
    }
  }

  return memory;
}

// Update skill content
export function updateSkill(groupFolder: string, skillName: string, content: string): void {
  const skillPath = path.join(
    DATA_DIR,
    'sessions',
    groupFolder,
    '.claude',
    'skills',
    skillName,
    'SKILL.md'
  );

  const dir = path.dirname(skillPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(skillPath, content, 'utf-8');
  logger.info({ groupFolder, skillName }, 'Skill updated');
}

// Update memory file
export function updateMemory(groupFolder: string, filename: string, content: string): void {
  const groupDir = resolveGroupFolderPath(groupFolder);
  const filePath = path.join(groupDir, filename);

  fs.writeFileSync(filePath, content, 'utf-8');
  logger.info({ groupFolder, filename }, 'Memory file updated');
}

// Delete memory file
export function deleteMemory(groupFolder: string, filename: string): void {
  const groupDir = resolveGroupFolderPath(groupFolder);
  const filePath = path.join(groupDir, filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    logger.info({ groupFolder, filename }, 'Memory file deleted');
  }
}

// Get skill content
export function getSkillContent(groupFolder: string, skillName: string): string | null {
  const skillPath = path.join(
    DATA_DIR,
    'sessions',
    groupFolder,
    '.claude',
    'skills',
    skillName,
    'SKILL.md'
  );

  if (fs.existsSync(skillPath)) {
    return fs.readFileSync(skillPath, 'utf-8');
  }
  return null;
}

// Get memory file content
export function getMemoryContent(groupFolder: string, filename: string): string | null {
  const groupDir = resolveGroupFolderPath(groupFolder);
  const filePath = path.join(groupDir, filename);

  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return null;
}

// Helper to resolve group folder path
function resolveGroupFolderPath(groupFolder: string): string {
  // First check if it's a direct path
  if (groupFolder.startsWith('/')) {
    return groupFolder;
  }

  // Check in GROUPS_DIR
  const groupPath = path.join(GROUPS_DIR, groupFolder);
  if (fs.existsSync(groupPath)) {
    return groupPath;
  }

  // Check in DATA_DIR/sessions
  const sessionPath = path.join(DATA_DIR, 'sessions', groupFolder);
  if (fs.existsSync(sessionPath)) {
    return sessionPath;
  }

  // Default to GROUPS_DIR
  return groupPath;
}