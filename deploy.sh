#!/bin/bash
# NanoClaw 部署脚本 - 无需root权限
# 适用于 Linux 系统

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
USER_HOME="${HOME:-$(pwd)}"
LOG_DIR="$PROJECT_ROOT/logs"

info "=========================================="
info "NanoClaw 部署脚本"
info "=========================================="
echo ""

# ============================================
# 1. 环境检查
# ============================================
info "[1/8] 检查系统环境..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    error "Node.js 未安装，请先安装 Node.js 20+"
    exit 1
fi
NODE_VERSION=$(node -v)
info "  ✓ Node.js: $NODE_VERSION"

# 检查 npm
if ! command -v npm &> /dev/null; then
    error "npm 未安装"
    exit 1
fi
info "  ✓ npm: $(npm -v)"

# 检查 Docker
if ! command -v docker &> /dev/null; then
    error "Docker 未安装，请先安装 Docker"
    exit 1
fi
info "  ✓ Docker: $(docker -v)"

# 检查用户是否在 docker 组
if ! groups | grep -q docker; then
    warn "  当前用户不在 docker 组中，Docker 可能需要 sudo"
    warn "  运行: sudo usermod -aG docker $USER && newgrp docker"
fi

# 检查 systemd (用户级)
if ! systemctl --user &> /dev/null; then
    warn "  systemd 用户级服务可能不可用"
fi

echo ""

# ============================================
# 2. 安装依赖
# ============================================
info "[2/8] 安装 Node.js 依赖..."

cd "$PROJECT_ROOT"

if [ ! -d "node_modules" ]; then
    info "  运行 npm install..."
    npm install
else
    info "  ✓ 依赖已安装"
fi

echo ""

# ============================================
# 3. 编译项目
# ============================================
info "[3/8] 编译 TypeScript 项目..."

npm run build

if [ ! -f "dist/index.js" ]; then
    error "编译失败，dist/index.js 不存在"
    exit 1
fi
info "  ✓ 编译完成"

echo ""

# ============================================
# 4. 构建容器镜像
# ============================================
info "[4/8] 构建 Agent 容器镜像..."

cd "$PROJECT_ROOT/container"

if docker images | grep -q "nanoclaw-agent"; then
    warn "  容器镜像已存在"
    echo ""
    echo "  如果 Dockerfile 有更新，需要重新构建镜像。"
    read -p "  是否重新构建镜像? [y/N, 默认: N]: " REBUILD_CHOICE
    REBUILD_CHOICE=${REBUILD_CHOICE:-n}

    if [ "$REBUILD_CHOICE" = "y" ] || [ "$REBUILD_CHOICE" = "Y" ]; then
        info "  删除旧镜像并重新构建..."
        docker rmi nanoclaw-agent:latest 2>/dev/null || true
        ./build.sh
        info "  ✓ 镜像重新构建完成"
    else
        info "  跳过镜像构建，使用现有镜像"
    fi
else
    info "  运行 ./build.sh..."
    ./build.sh
    info "  ✓ 镜像构建完成"
fi

echo ""

# ============================================
# 5. 配置飞书凭证
# ============================================
info "[5/8] 配置飞书凭证..."

AUTH_DIR="$PROJECT_ROOT/store/auth/feishu"
AUTH_FILE="$AUTH_DIR/credentials.json"

mkdir -p "$AUTH_DIR"

if [ -f "$AUTH_FILE" ]; then
    info "  ✓ 凭证文件已存在: $AUTH_FILE"
else
    warn "  需要配置飞书应用凭证"
    echo ""
    echo "  请按以下步骤获取飞书应用凭证："
    echo "  1. 访问 https://open.feishu.cn/app"
    echo "  2. 创建应用或选择已有应用"
    echo "  3. 获取 App ID 和 App Secret"
    echo ""

    read -p "  请输入飞书 App ID: " APP_ID
    read -p "  请输入飞书 App Secret: " APP_SECRET

    if [ -z "$APP_ID" ] || [ -z "$APP_SECRET" ]; then
        error "App ID 或 App Secret 不能为空"
        exit 1
    fi

    cat > "$AUTH_FILE" << EOF
{
  "appId": "$APP_ID",
  "appSecret": "$APP_SECRET"
}
EOF

    chmod 600 "$AUTH_FILE"
    info "  ✓ 凭证已保存到: $AUTH_FILE"
fi

echo ""

# ============================================
# 6. 配置大模型 API
# ============================================
info "[6/8] 配置大模型 API..."

ENV_FILE="$PROJECT_ROOT/.env"

if [ -f "$ENV_FILE" ]; then
    info "  ✓ .env 文件已存在: $ENV_FILE"
    warn "  如需重新配置，请编辑 .env 文件或删除后重新运行"
else
    echo ""
    echo "  请选择 API 提供商:"
    echo "  1) Anthropic 官方 API (推荐)"
    echo "  2) 自定义 API 地址 (如第三方代理、本地模型等)"
    echo ""
    read -p "  请选择 [1/2, 默认: 1]: " API_CHOICE
    API_CHOICE=${API_CHOICE:-1}

    if [ "$API_CHOICE" = "2" ]; then
        echo ""
        read -p "  请输入 API 地址 (如 https://api.example.com): " API_BASE_URL
        read -p "  请输入 API 密钥: " API_KEY
        read -p "  请输入模型名称 (如 claude-sonnet-4-20250514): " MODEL_NAME

        if [ -z "$API_BASE_URL" ] || [ -z "$API_KEY" ]; then
            error "API 地址或密钥不能为空"
            exit 1
        fi

        cat > "$ENV_FILE" << EOF
# 大模型 API 配置
ANTHROPIC_BASE_URL=$API_BASE_URL
ANTHROPIC_AUTH_TOKEN=$API_KEY
${MODEL_NAME:+MODEL_NAME=$MODEL_NAME}
EOF
    else
        echo ""
        echo "  使用 Anthropic 官方 API"
        read -p "  请输入 API 密钥 (sk-ant-xxx): " API_KEY

        if [ -z "$API_KEY" ]; then
            error "API 密钥不能为空"
            exit 1
        fi

        cat > "$ENV_FILE" << EOF
# 大模型 API 配置 (Anthropic 官方)
ANTHROPIC_AUTH_TOKEN=$API_KEY
EOF
    fi

    chmod 600 "$ENV_FILE"
    info "  ✓ API 配置已保存到: $ENV_FILE"
fi

echo ""

# ============================================
# 7. 安装 systemd 服务
# ============================================
info "[7/8] 安装 systemd 用户服务..."

# 创建日志目录
mkdir -p "$LOG_DIR"

# 创建 systemd 服务目录
SYSTEMD_DIR="$USER_HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_DIR"

# 生成服务文件
SERVICE_FILE="$SYSTEMD_DIR/nanoclaw.service"
NODE_BIN=$(command -v node)

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=NanoClaw AI Assistant
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=$PROJECT_ROOT
ExecStart=$NODE_BIN $PROJECT_ROOT/dist/index.js
Restart=always
RestartSec=10
Environment="PATH=$USER_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
Environment="HOME=$USER_HOME"
Environment="ASSISTANT_NAME=Andy"
EnvironmentFile=$ENV_FILE

[Install]
WantedBy=default.target
EOF

info "  ✓ 服务文件已创建: $SERVICE_FILE"

# 重新加载 systemd
systemctl --user daemon-reload 2>/dev/null || true
info "  ✓ systemd 配置已重载"

echo ""

# ============================================
# 8. 启动服务
# ============================================
info "[8/8] 启动 NanoClaw 服务..."

# 启用服务
systemctl --user enable nanoclaw 2>/dev/null || true

# 检查服务是否已在运行
if systemctl --user is-active --quiet nanoclaw; then
    info "  服务已在运行，重启中..."
    systemctl --user restart nanoclaw
else
    info "  启动服务..."
    systemctl --user start nanoclaw
fi

# 等待服务启动
sleep 2

# 显示服务状态
if systemctl --user is-active --quiet nanoclaw; then
    info "  ✓ NanoClaw 服务已启动"
else
    error "  服务启动失败，请查看日志"
    echo ""
    echo "  查看错误日志:"
    echo "    journalctl --user -u nanoclaw -n 50"
    echo "    或: tail -f $LOG_DIR/*.log"
    exit 1
fi

echo ""
echo ""

# ============================================
# 完成
# ============================================
info "=========================================="
info "部署完成！"
info "=========================================="
echo ""
echo "常用命令:"
echo ""
echo "  查看服务状态:"
echo "    systemctl --user status nanoclaw"
echo ""
echo "  查看实时日志:"
echo "    journalctl --user -u nanoclaw -f"
echo "    或: tail -f $LOG_DIR/*.log"
echo ""
echo "  重启服务:"
echo "    systemctl --user restart nanoclaw"
echo ""
echo "  停止服务:"
echo "    systemctl --user stop nanoclaw"
echo ""
echo "  开机自启:"
echo "    systemctl --user enable nanoclaw"
echo ""
echo "  取消开机自启:"
echo "    systemctl --user disable nanoclaw"
echo ""
echo "配置文件位置:"
echo "  飞书凭证: $AUTH_FILE"
echo "  环境配置: $PROJECT_ROOT/.env (可选)"
echo "  服务文件: $SERVICE_FILE"
echo ""
