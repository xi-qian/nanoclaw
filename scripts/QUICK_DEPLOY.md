# 快速部署指南

## 本地推送代码到远程仓库

代码已经提交到本地仓库，现在需要推送到 GitHub。

### 方法 1: 使用 Personal Access Token (推荐)

1. **创建 GitHub Personal Access Token**:
   - 访问 https://github.com/settings/tokens
   - 点击 "Generate new token" → "Generate new token (classic)"
   - 勾选 `repo` 权限
   - 生成并复制 token

2. **推送代码**:
   ```bash
   # 推送时输入用户名和 token
   git push origin main
   # Username: 你的 GitHub 用户名
   # Password: 粘贴刚才的 token (不是密码！)
   ```

### 方法 2: 使用 SSH 密钥

1. **配置 SSH 密钥**:
   ```bash
   # 检查是否有 SSH 密钥
   ls ~/.ssh/id_rsa.pub

   # 如果没有，生成新密钥
   ssh-keygen -t rsa -b 4096 -C "your_email@example.com"

   # 查看公钥
   cat ~/.ssh/id_rsa.pub
   ```

2. **添加 SSH 密钥到 GitHub**:
   - 复制公钥内容
   - 访问 https://github.com/settings/keys
   - 点击 "New SSH key"
   - 粘贴公钥

3. **切换远程仓库 URL 为 SSH**:
   ```bash
   git remote set-url origin git@github.com:xi-qian/nanoclaw.git
   git push origin main
   ```

### 方法 3: 使用 Git Credential Helper

```bash
# 配置 credential helper (缓存 token 1 小时)
git config --global credential.helper cache

# 推送时输入一次 token
git push origin main
```

---

## 服务器部署步骤

### 1. SSH 连接到服务器

```bash
ssh user@your-server.com
```

### 2. 一键部署脚本

```bash
# 方法 1: 从 GitHub 直接下载并运行
curl -fsSL https://raw.githubusercontent.com/xi-qian/nanoclaw/main/scripts/deploy.sh | bash

# 方法 2: 先下载再运行
wget https://raw.githubusercontent.com/xi-qian/nanoclaw/main/scripts/deploy.sh
chmod +x deploy.sh
./deploy.sh
```

### 3. 手动部署（如果自动脚本失败）

```bash
# 克隆代码
git clone -b main https://github.com/xi-qian/nanoclaw.git ~/nanoclaw
cd ~/nanoclaw

# 安装依赖
npm install

# 编译
npm run build

# 构建容器 (可选)
./container/build.sh
```

### 4. 配置飞书凭证

```bash
# 创建凭证目录
mkdir -p ~/nanoclaw/store/auth/feishu

# 编辑凭证文件
vi ~/nanoclaw/store/auth/feishu/credentials.json
```

输入内容:
```json
{
  "appId": "cli_xxxxxxxxxxxxx",
  "appSecret": "xxxxxxxxxxxxxxxxxxxx"
}
```

### 5. 启动服务

```bash
# 使用 systemd
systemctl --user start nanoclaw
systemctl --user enable nanoclaw

# 查看状态
systemctl --user status nanoclaw

# 查看日志
journalctl --user -u nanoclaw -f
```

---

## 更新代码

### 本地更新

```bash
# 做出修改后
git add .
git commit -m "your message"
git push origin main
```

### 服务器更新

```bash
# SSH 到服务器后
cd ~/nanoclaw
git pull origin main
npm install
npm run build
systemctl --user restart nanoclaw
```

---

## 验证部署

### 检查服务状态

```bash
# 查看服务是否运行
systemctl --user is-active nanoclaw

# 查看服务状态详情
systemctl --user status nanoclaw

# 查看最近的日志
journalctl --user -u nanoclaw -n 50
```

### 查看飞书相关日志

```bash
# 查看飞书 WebSocket 连接日志
journalctl --user -u nanoclaw | grep -i feishu

# 实时监控飞书日志
journalctl --user -u nanoclaw -f | grep -i feishu
```

---

## 常见问题

### 问题 1: git push 失败

**错误**: `could not read Username`

**解决**:
- 使用 Personal Access Token (方法 1)
- 或切换到 SSH (方法 2)

### 问题 2: 服务器 Node.js 版本过低

**检查**:
```bash
node -v  # 需要 18+
```

**解决**:
```bash
# 使用 nvm 安装
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install --lts
nvm use --lts
```

### 问题 3: systemd 服务无法启动

**查看错误**:
```bash
journalctl --user -u nanoclaw -n 50 --no-pager
```

**可能原因**:
- Node.js 未安装或版本不对
- 依赖未安装 (运行 `npm install`)
- 编译失败 (运行 `npm run build`)

### 问题 4: 飞书凭证配置错误

**检查凭证**:
```bash
cat ~/nanoclaw/store/auth/feishu/credentials.json
```

**正确格式**:
```json
{
  "appId": "cli_xxxxxxxxxxxxx",
  "appSecret": "xxxxxxxxxxxxxxxxxxxx"
}
```

---

## 下一步

1. ✅ **推送代码到 GitHub** (使用上面的方法 1 或 2)
2. ✅ **SSH 连接到服务器**
3. ✅ **运行部署脚本**
4. ✅ **配置飞书凭证**
5. ✅ **启动服务**
6. ✅ **完成 OAuth 认证** (在支持的聊天平台发送消息)
7. ✅ **验证 WebSocket 连接** (查看日志)

详细文档请参考: `docs/SERVER_DEPLOYMENT.md`
