# syntax=docker/dockerfile:1.4
# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation
#
# Slow apt (e.g. China): ./build.sh --cn-mirror (apt + npm use CN-friendly defaults).
# Or set APT_MIRROR_* / NPM_CONFIG_REGISTRY yourself.

FROM node:22-slim

# Optional: replace default Debian repos before apt (Bookworm uses deb822 debian.sources)
ARG APT_MIRROR_DEBIAN=
ARG APT_MIRROR_SECURITY=

# Optional: npm registry for `npm install` / `npm install -g` (e.g. https://registry.npmmirror.com in China)
ARG NPM_CONFIG_REGISTRY=

# Install system dependencies for Chromium and Python (skills / user scripts)
#
# http:// mirrors: apply sed *before* first apt-get update so ca-certificates + chromium download from the
# mirror (otherwise the first update still hits deb.debian.org and is slow in China).
# https:// mirrors: install ca-certificates from default Debian first, then sed, then update (TLS needs CA).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eux; \
    apply_mirrors() { \
      if [ -n "${APT_MIRROR_DEBIAN}" ]; then \
        if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
          sed -i \
            -e "s|http://deb.debian.org/debian|${APT_MIRROR_DEBIAN}|g" \
            -e "s|https://deb.debian.org/debian|${APT_MIRROR_DEBIAN}|g" \
            /etc/apt/sources.list.d/debian.sources; \
        fi; \
        if [ -f /etc/apt/sources.list ]; then \
          sed -i \
            -e "s|http://deb.debian.org/debian|${APT_MIRROR_DEBIAN}|g" \
            -e "s|https://deb.debian.org/debian|${APT_MIRROR_DEBIAN}|g" \
            /etc/apt/sources.list; \
        fi; \
      fi; \
      if [ -n "${APT_MIRROR_SECURITY}" ]; then \
        if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
          sed -i \
            -e "s|http://security.debian.org/debian-security|${APT_MIRROR_SECURITY}|g" \
            -e "s|https://security.debian.org/debian-security|${APT_MIRROR_SECURITY}|g" \
            /etc/apt/sources.list.d/debian.sources; \
        fi; \
        if [ -f /etc/apt/sources.list ]; then \
          sed -i \
            -e "s|http://security.debian.org/debian-security|${APT_MIRROR_SECURITY}|g" \
            -e "s|https://security.debian.org/debian-security|${APT_MIRROR_SECURITY}|g" \
            /etc/apt/sources.list; \
        fi; \
      fi; \
    }; \
    mirrors_set=0; \
    if [ -n "${APT_MIRROR_DEBIAN}" ] || [ -n "${APT_MIRROR_SECURITY}" ]; then mirrors_set=1; fi; \
    https_mirror=0; \
    [ -n "${APT_MIRROR_DEBIAN}" ] && case "${APT_MIRROR_DEBIAN}" in https://*) https_mirror=1;; esac; \
    [ -n "${APT_MIRROR_SECURITY}" ] && case "${APT_MIRROR_SECURITY}" in https://*) https_mirror=1;; esac; \
    if [ "$mirrors_set" = "1" ] && [ "$https_mirror" = "0" ]; then apply_mirrors; fi; \
    apt-get update; \
    if [ "$mirrors_set" = "1" ] && [ "$https_mirror" = "1" ]; then \
      apt-get install -y --no-install-recommends ca-certificates; \
      apply_mirrors; \
      apt-get update; \
    fi; \
    apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    poppler-utils \
    pandoc \
    python3 \
    python3-pip \
    python3-venv \
    libreoffice-writer-nogui \
    libreoffice-impress-nogui \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser and claude-code globally
RUN --mount=type=cache,target=/root/.npm \
    set -eux; \
    if [ -n "${NPM_CONFIG_REGISTRY}" ]; then npm config set registry "${NPM_CONFIG_REGISTRY}"; fi; \
    npm install -g agent-browser @anthropic-ai/claude-code pptxgenjs react-icons react react-dom sharp

# Install Python packages for pptx skill
RUN --mount=type=cache,target=/root/.cache/pip \
    pip3 install --break-system-packages \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    "markitdown[pptx]" \
    Pillow \
    defusedxml

# Create Claude SDK config directory and add onboarding flag
RUN mkdir -p /home/node/.config && \
    echo '{"hasCompletedOnboarding": true}' > /home/node/.claude.json && \
    chmod 644 /home/node/.claude.json

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies (/root/.npmrc registry from previous RUN applies)
RUN --mount=type=cache,target=/root/.npm \
    npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input /workspace/ipc/downloads

# Create entrypoint script
# Container input (prompt, group info) is passed via stdin JSON.
# Credentials are injected by the host's credential proxy — never passed here.
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
RUN printf '#!/bin/bash\nset -e\ncd /app && npx tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\ncat > /tmp/input.json\nnode /tmp/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace && chmod 777 /home/node

# Switch to non-root user (required for --dangerously-skip-permissions)
USER node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
