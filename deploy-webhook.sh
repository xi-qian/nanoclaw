#!/bin/bash
# NanoClaw Webhook 远程部署脚本
# 用法: ./deploy-webhook.sh [server] [remote-dir]
#   未传参数时交互式询问
#   示例: ./deploy-webhook.sh root@1.2.3.4
#   示例: ./deploy-webhook.sh root@1.2.3.4 /opt/nanoclaw-webhook
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 交互式获取部署参数
SERVER="${1:-}"
REMOTE_DIR="${2:-}"

if [ -z "$SERVER" ]; then
    read -p "服务器地址 (如 root@1.2.3.4): " SERVER
    if [ -z "$SERVER" ]; then
        error "服务器地址不能为空"
        exit 1
    fi
fi

if [ -z "$REMOTE_DIR" ]; then
    read -p "部署目录 [默认: /root/nanoclaw-webhook]: " REMOTE_DIR
    REMOTE_DIR="${REMOTE_DIR:-/root/nanoclaw-webhook}"
fi

info "=========================================="
info "NanoClaw Webhook 远程部署"
info "目标: $SERVER:$REMOTE_DIR"
info "=========================================="
echo ""

# 1. 构建
info "[1/6] 编译项目..."
npm run build 2>&1 | tail -1
if [ ! -f "dist/index.js" ]; then
    error "编译失败: dist/index.js 不存在"
    exit 1
fi
info "  ✓ 编译完成"

# 2. 打包
info "[2/6] 打包部署文件..."
TARBALL="/tmp/nanoclaw-webhook-deploy-$(date +%Y%m%d%H%M%S).tar.gz"
tar czf "$TARBALL" \
    --exclude='.git' \
    --exclude='./src' \
    --exclude='docs' \
    --exclude='logs' \
    --exclude='data' \
    --exclude='store' \
    dist/ package.json package-lock.json groups/ container/ \
    nanoclaw-webhook.service
info "  ✓ 打包完成: $(du -h "$TARBALL" | cut -f1)"

# 3. 上传
info "[3/6] 上传到服务器..."
scp "$TARBALL" "$SERVER:/tmp/"
rm -f "$TARBALL"
info "  ✓ 上传完成"

# 4. 服务器上解压和安装
info "[4/6] 服务器端安装..."
ssh "$SERVER" << DEPLOY
set -e

# 停服
systemctl stop nanoclaw-webhook 2>/dev/null || true
docker ps --filter name=nanoclaw -q | xargs -r docker stop 2>/dev/null || true

# 备份旧 .env 和 store
if [ -d "$REMOTE_DIR" ]; then
    [ -f "$REMOTE_DIR/.env" ] && cp "$REMOTE_DIR/.env" /tmp/nanoclaw-env.bak
    [ -d "$REMOTE_DIR/store" ] && cp -a "$REMOTE_DIR/store" /tmp/nanoclaw-store.bak
fi

# 清理并解压
rm -rf "$REMOTE_DIR"
mkdir -p "$REMOTE_DIR"
cd "$REMOTE_DIR"
tar xzf "/tmp/$(basename "$TARBALL")"
rm -f "/tmp/$(basename "$TARBALL")"

# 安装依赖 (跳过 husky 等 dev 脚本)
npm install --production --ignore-scripts 2>&1 | tail -1

# 重建 native 模块 (适配服务器 Node 版本)
npm rebuild better-sqlite3 2>&1 | tail -1

# 恢复旧数据
[ -f /tmp/nanoclaw-env.bak ] && cp /tmp/nanoclaw-env.bak "$REMOTE_DIR/.env" && rm -f /tmp/nanoclaw-env.bak
[ -d /tmp/nanoclaw-store.bak ] && cp -a /tmp/nanoclaw-store.bak "$REMOTE_DIR/store" && rm -rf /tmp/nanoclaw-store.bak

# 创建运行时目录
mkdir -p data store

# 数据库迁移 (幂等 — 列已存在则跳过)
node -e "
const D=require('better-sqlite3');
const d=new D('store/messages.db');
try { d.exec('ALTER TABLE messages ADD COLUMN scheduled_task_id TEXT'); console.log('  DB migration: scheduled_task_id added') }
catch(e) { if(!e.message.includes('duplicate')) throw e; else console.log('  DB migration: column already exists') }
d.close();
"

echo "  ✓ 安装完成"
DEPLOY
info "  ✓ 服务器端配置完成"

# 5. 安装系统服务
info "[5/6] 安装 systemd 服务..."
ssh "$SERVER" << SYSTEMD
set -e
cp "$REMOTE_DIR/nanoclaw-webhook.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable nanoclaw-webhook
echo "  ✓ 服务已安装"
SYSTEMD
info "  ✓ systemd 服务配置完成"

# 5.5 安装 Nginx 反向代理 (可选)
echo ""
read -p "是否配置 Nginx 反向代理? [y/N]: " NGINX_CHOICE
NGINX_CHOICE=${NGINX_CHOICE:-n}
if [ "$NGINX_CHOICE" = "y" ] || [ "$NGINX_CHOICE" = "Y" ]; then
    info "[6/7] 配置 Nginx 反向代理..."
    scp nginx-webhook.conf "$SERVER:/tmp/"
    ssh "$SERVER" << NGINX
if [ ! -f /etc/nginx/sites-enabled/nanoclaw-webhook ]; then
    cp /tmp/nginx-webhook.conf /etc/nginx/sites-available/nanoclaw-webhook
    ln -s /etc/nginx/sites-available/nanoclaw-webhook /etc/nginx/sites-enabled/nanoclaw-webhook
    nginx -t && systemctl reload nginx
    echo "  ✓ Nginx 反向代理已配置"
else
    cp /tmp/nginx-webhook.conf /etc/nginx/sites-available/nanoclaw-webhook
    nginx -t && systemctl reload nginx
    echo "  ✓ Nginx 配置已更新"
fi
rm -f /tmp/nginx-webhook.conf
NGINX
    info "  ✓ Nginx 反向代理就绪"
else
    info "[6/7] 跳过 Nginx 配置"
fi

# 7. 启动
info "[7/7] 启动服务..."
ssh "$SERVER" "systemctl restart nanoclaw-webhook && sleep 3 && systemctl is-active --quiet nanoclaw-webhook && echo '  ✓ 服务运行中' || echo '  ✗ 启动失败'"

echo ""
info "=========================================="
info "部署完成"
info "=========================================="
echo ""
echo "查看日志:"
echo "  ssh $SERVER 'journalctl -u nanoclaw-webhook -f'"
echo "查看状态:"
echo "  ssh $SERVER 'systemctl status nanoclaw-webhook'"
echo "重启服务:"
echo "  ssh $SERVER 'systemctl restart nanoclaw-webhook'"
echo ""
echo "服务器配置文件:"
echo "  systemd 服务: /etc/systemd/system/nanoclaw-webhook.service"
echo "  Nginx 代理:   /etc/nginx/sites-available/nanoclaw-webhook"
echo "  飞书凭证:     $REMOTE_DIR/store/auth/feishu/credentials.json"
echo "  环境配置:     $REMOTE_DIR/.env"
