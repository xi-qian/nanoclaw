/**
 * Feishu Logger
 *
 * 飞书模块专用的日志记录器
 */

import { logger } from '../logger.js';

/**
 * 飞书模块的命名空间
 */
const FEISHU_LOG_NAMESPACE = 'feishu';

/**
 * 创建飞书子模块的日志记录器
 */
export function larkLogger(module: string) {
  const fullNamespace = `${FEISHU_LOG_NAMESPACE}/${module}`;
  return logger.child({ namespace: fullNamespace });
}
