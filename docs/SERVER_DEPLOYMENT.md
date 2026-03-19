# 服务器部署指南

本文档说明如何将 NanoClaw 飞书集成部署到远程服务器。

## 前置要求

### 服务器环境

- **操作系统**: Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+)
- **Node.js**: 18+ (推荐使用 [nvm](https://github.com/nvm-sh/nvm) 安装)
- **Git**: 用于克隆代码仓库
- **内存**: 至少 2GB RAM
- **磁盘**: 至少 5GB 可用空间

### 本地环境

- 配置好 SSH 密钥登录到服务器
- 有代码仓库的推送权限

## 部署步骤

### 1. 准备服务器环境

#### SSH 连接到服务器

```bash
ssh user@your-server.com
```

#### 安装 Node.js 18+

使用 nvm (推荐):

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 重新加载 shell 配置
source ~/.bashrc

# 安装 Node.js LTS
nvm install --lts
nvm use --lts
```

或使用包管理器:

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
```

#### 启用 systemd 用户服务

如果使用 systemd 管理，需要启用 linger (保持用户服务在登出后运行):

```bash
sudo loginctl enable-linger $(whoami)
```

### 2. 部署代码

#### 方式 1: 使用自动部署脚本 (推荐)

```bash
# 在服务器上运行
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/nanoclaw/main/scripts/deploy.sh | bash
```

或手动下载并运行:

```bash
# 下载部署脚本
wget https://raw.githubusercontent.com/YOUR_USERNAME/nanoclaw/main/scripts/deploy.sh

# 添加执行权限
chmod +x deploy.sh

# 运行部署
./deploy.sh
```

#### 方式 2: 手动部署

```bash
# 克隆代码仓库
git clone -b main https://github.com/YOUR_USERNAME/nanoclaw.git ~/nanoclaw
cd ~/nanoclaw

# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 构建 agent container (可选)
./container/build.sh
```

### 3. 配置飞书凭证

#### 创建凭证文件

```bash
mkdir -p ~/nanoclaw/store/auth/feishu
cat > ~/nanoclaw/store/auth/feishu/credentials.json << 'EOF'
{
  "appId": "cli_xxxxxxxxxxxxx",
  "appSecret": "xxxxxxxxxxxxxxxxxxxx"
}
EOF
```

#### 获取飞书凭证

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建自建应用
3. 在应用详情页获取 **App ID** 和 **App Secret**
4. 配置权限:
   - `im:message` - 获取与发送消息
   - `im:message:send_as_bot` - 以机器人身份发送
   - `im:chat` - 访问聊天信息
   - `docx:document` - 读取文档
   - `docx:document:write` - 创建和编辑文档

### 4. 启动服务

#### 使用 systemd (推荐)

```bash
# 启动服务
systemctl --user start nanoclaw

# 设置开机自启
systemctl --user enable nanoclaw

# 查看服务状态
systemctl --user status nanoclaw

# 查看日志
journalctl --user -u nanoclaw -f
```

#### 手动运行 (测试)

```bash
cd ~/nanoclaw
npm start
```

### 5. 完成 OAuth 认证

飞书集成需要完成 OAuth UAT 授权流程:

1. **在支持的聊天平台发送消息给 NanoClaw**:
   ```
   @nanoclaw 完成飞书认证
   ```

2. **按照提示完成授权**:
   - 访问验证页面
   - 输入授权码
   - 等待授权完成

3. **验证连接**:
   ```bash
   # 查看日志确认 WebSocket 连接成功
   journalctl --user -u nanoclaw -f | grep -i feishu
   ```

## 代码更新

### 本地推送更新

```bash
# 在本地机器
git add .
git commit -m "feat: 飞书集成功能更新"
git push origin main
```

### 服务器拉取更新

```bash
# 在服务器上
cd ~/nanoclaw
git pull origin main
npm install
npm run build
systemctl --user restart nanoclaw
```

### 自动化更新脚本

创建 `~/update-nanoclaw.sh`:

```bash
#!/bin/bash
cd ~/nanoclaw
git pull origin main
npm install
npm run build
systemctl --user restart nanoclaw
echo "NanoClaw updated successfully!"
```

使用:

```bash
chmod +x ~/update-nanoclaw.sh
~/update-nanoclaw.sh
```

## 服务管理

### systemd 命令

```bash
# 启动服务
systemctl --user start nanoclaw

# 停止服务
systemctl --user stop nanoclaw

# 重启服务
systemctl --user restart nanoclaw

# 查看状态
systemctl --user status nanoclaw

# 查看日志 (实时)
journalctl --user -u nanoclaw -f

# 查看最近 100 条日志
journalctl --user -u nanoclaw -n 100

# 查看今天的日志
journalctl --user -u nanoclaw --since today
```

### 日志过滤

```bash
# 只查看错误日志
journalctl --user -u nanoclaw -p err

# 查看飞书相关日志
journalctl --user -u nanoclaw | grep -i feishu

# 查看今天的飞书日志
journalctl --user -u nanoclaw --since today | grep -i feishu
```

## 故障排查

### 服务无法启动

```bash
# 查看详细错误日志
journalctl --user -u nanoclaw -n 50 --no-pager

# 检查端口占用
sudo netstat -tulpn | grep node

# 检查文件权限
ls -la ~/nanoclaw/store/
```

### 飞书连接失败

1. **检查凭证**:
   ```bash
   cat ~/nanoclaw/store/auth/feishu/credentials.json
   ```

2. **检查网络**:
   ```bash
   # 测试飞书 API 连通性
   curl -I https://open.feishu.cn
   ```

3. **查看认证状态**:
   ```bash
   # 检查是否有 access_token
   cat ~/nanoclaw/store/auth/feishu/credentials.json | grep accessToken
   ```

### WebSocket 连接问题

```bash
# 查看 WebSocket 连接日志
journalctl --user -u nanoclaw | grep -i websocket

# 重新认证
systemctl --user stop nanoclaw
# 删除过期的 token
vi ~/nanoclaw/store/auth/feishu/credentials.json
systemctl --user start nanoclaw
```

## 监控和维护

### 定期检查

创建检查脚本 `~/check-nanoclaw.sh`:

```bash
#!/bin/bash
echo "=== NanoClaw Status Check ==="
echo ""
echo "Service Status:"
systemctl --user is-active nanoclaw && echo "✓ Running" || echo "✗ Stopped"
echo ""
echo "Recent Logs:"
journalctl --user -u nanoclaw -n 5 --no-pager
echo ""
echo "Disk Usage:"
du -sh ~/nanoclaw
```

### 日志轮转

systemd 会自动管理日志，但可以配置保留策略:

```bash
# 创建日志配置
sudo mkdir -p /etc/systemd/journald.conf.d
sudo vi /etc/systemd/journald.conf.d/nanoclaw.conf
```

添加内容:

```ini
[Journal]
SystemMaxUse=500M
MaxRetentionSec=30day
```

重启 journald:

```bash
sudo systemctl restart systemd-journald
```

## 安全建议

1. **使用防火墙**:
   ```bash
   # 只开放必要的端口
   sudo ufw allow 22    # SSH
   sudo ufw enable
   ```

2. **定期更新**:
   ```bash
   # 定期更新系统和依赖
   sudo apt update && sudo apt upgrade -y
   cd ~/nanoclaw && npm update
   ```

3. **备份配置**:
   ```bash
   # 定期备份飞书凭证
   cp ~/nanoclaw/store/auth/feishu/credentials.json ~/backup/
   ```

4. **监控资源使用**:
   ```bash
   # 查看内存和 CPU 使用
   systemctl --user status nanoclaw
   htop
   ```
