#!/bin/bash
#
# NanoClaw 飞书集成部署脚本
# 用于在服务器上部署和更新 NanoClaw
#

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 打印带颜色的消息
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否以 root 运行
if [ "$EUID" -eq 0 ]; then
    error "请不要使用 root 用户运行此脚本"
    exit 1
fi

# 项目配置
REPO_URL="${REPO_URL:-https://github.com/qwibitai/nanoclaw.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="$HOME/nanoclaw"
SERVICE_NAME="nanoclaw"

info "=========================================="
info "NanoClaw 飞书集成部署"
info "=========================================="

# 1. 检查 Node.js
info "检查 Node.js..."
if ! command -v node &> /dev/null; then
    error "Node.js 未安装，请先安装 Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    error "Node.js 版本过低 (需要 18+)，当前版本: $(node -v)"
    exit 1
fi

info "Node.js 版本: $(node -v) ✓"

# 2. 克隆或更新代码
if [ -d "$INSTALL_DIR" ]; then
    info "更新现有代码..."
    cd "$INSTALL_DIR"
    git fetch origin
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
else
    info "克隆代码仓库..."
    git clone -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# 3. 安装依赖
info "安装 npm 依赖..."
npm install

# 4. 编译 TypeScript
info "编译 TypeScript..."
npm run build

# 5. 检查飞书凭证
info "检查飞书凭证..."
if [ ! -f "store/auth/feishu/credentials.json" ]; then
    warn "飞书凭证文件不存在"
    info "创建凭证目录..."
    mkdir -p store/auth/feishu

    info "请手动配置飞书凭证："
    info "1. 访问飞书开放平台: https://open.feishu.cn/"
    info "2. 创建应用并获取 App ID 和 App Secret"
    info "3. 编辑凭证文件: vi $INSTALL_DIR/store/auth/feishu/credentials.json"
    info ""
    info "凭证文件格式："
    cat << 'EOF'
{
  "appId": "cli_xxxxxxxxxxxxx",
  "appSecret": "xxxxxxxxxxxxxxxxxxxx"
}
EOF
    info ""
    warn "配置完成后，需要完成 OAuth 认证流程："
    warn "运行: cd $INSTALL_DIR && npm start"
    warn "然后在对话中发送认证命令"
fi

# 6. 构建容器（可选）
if [ "$BUILD_CONTAINER" = "true" ]; then
    info "构建 agent container..."
    ./container/build.sh
fi

# 7. 创建 systemd service
info "创建 systemd service..."

SERVICE_FILE="$HOME/.config/systemd/user/$SERVICE_NAME.service"
mkdir -p "$(dirname "$SERVICE_FILE")"

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=NanoClaw Feishu Integration
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$(command -v node) $INSTALL_DIR/dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# 环境变量
Environment="NODE_ENV=production"

[Install]
WantedBy=default.target
EOF

# 8. 重新加载 systemd
info "重新加载 systemd..."
systemctl --user daemon-reload

# 9. 启用服务
info "启用 systemd service..."
systemctl --user enable "$SERVICE_NAME"

info "=========================================="
info "部署完成！"
info "=========================================="
info ""
info "管理命令："
info "  启动服务: systemctl --user start $SERVICE_NAME"
info "  停止服务: systemctl --user stop $SERVICE_NAME"
info "  重启服务: systemctl --user restart $SERVICE_NAME"
info "  查看日志: journalctl --user -u $SERVICE_NAME -f"
info "  查看状态: systemctl --user status $SERVICE_NAME"
info ""
warn "别忘了配置飞书凭证并完成 OAuth 认证！"
info "=========================================="
