// Instance detail page logic
let currentInstanceId = null;

(async function initInstancePage() {
  // Check authentication
  await auth.requireAuth();

  // Setup logout button
  document.getElementById('logoutBtn').addEventListener('click', () => {
    auth.logout();
  });

  // Get instance ID from URL
  const params = new URLSearchParams(window.location.search);
  currentInstanceId = params.get('id');

  if (!currentInstanceId) {
    document.getElementById('instanceHeader').innerHTML =
      '<div class="alert alert-danger">缺少实例 ID 参数</div>';
    return;
  }

  // Load instance data
  loadInstanceHeader();
})();

async function loadInstanceHeader() {
  const headerDiv = document.getElementById('instanceHeader');

  try {
    const result = await api.getInstance(currentInstanceId);
    if (!result.success) {
      headerDiv.innerHTML = `<div class="alert alert-danger">加载失败: ${escapeHtml(result.error)}</div>`;
      return;
    }

    const inst = result.instance;
    const statusClass = getStatusClass(inst.status);
    const connectionBadge = inst.connected
      ? '<span class="badge bg-success">已连接</span>'
      : '<span class="badge bg-secondary">离线</span>';

    headerDiv.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div class="row">
            <div class="col-md-6">
              <h4>${escapeHtml(inst.hostname || inst.instance_id)}</h4>
              <p class="text-muted">ID: ${escapeHtml(inst.instance_id)}</p>
            </div>
            <div class="col-md-6 text-end">
              <span class="badge ${statusClass}">${escapeHtml(inst.status || '未知')}</span>
              ${connectionBadge}
            </div>
          </div>
          <div class="row mt-3">
            <div class="col-md-4">
              <small class="text-muted">版本: ${escapeHtml(inst.version || '未知')}</small>
            </div>
            <div class="col-md-4">
              <small class="text-muted">启动时间: ${inst.start_time ? formatTime(inst.start_time) : '未知'}</small>
            </div>
            <div class="col-md-4">
              <small class="text-muted">最后心跳: ${inst.last_heartbeat ? formatTime(inst.last_heartbeat) : '未知'}</small>
            </div>
          </div>
        </div>
      </div>
    `;

    // Load containers and groups
    loadContainers();
    loadGroups();
  } catch (err) {
    headerDiv.innerHTML = `<div class="alert alert-danger">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadContainers() {
  const bodyDiv = document.getElementById('containersBody');

  try {
    const result = await api.getContainers(currentInstanceId);
    if (!result.success) {
      bodyDiv.innerHTML = `<div class="alert alert-warning">加载失败: ${escapeHtml(result.error)}</div>`;
      return;
    }

    const containers = result.containers;

    if (containers.length === 0) {
      bodyDiv.innerHTML = '<div class="text-muted">暂无容器</div>';
      return;
    }

    bodyDiv.innerHTML = `
      <table class="table table-sm">
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>状态</th>
            <th>群组</th>
          </tr>
        </thead>
        <tbody>
          ${containers.map(c => `
            <tr>
              <td><small>${escapeHtml(c.container_id)}</small></td>
              <td>${escapeHtml(c.name || '-')}</td>
              <td><span class="badge ${getStatusClass(c.status)}">${escapeHtml(c.status)}</span></td>
              <td>${escapeHtml(c.group_folder || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    bodyDiv.innerHTML = `<div class="alert alert-warning">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadGroups() {
  const bodyDiv = document.getElementById('groupsBody');

  try {
    const result = await api.getGroups(currentInstanceId);
    if (!result.success) {
      bodyDiv.innerHTML = `<div class="alert alert-warning">加载失败: ${escapeHtml(result.error)}</div>`;
      return;
    }

    const groups = result.groups;

    if (!groups || groups.length === 0) {
      bodyDiv.innerHTML = '<div class="text-muted">暂无群组</div>';
      return;
    }

    bodyDiv.innerHTML = `
      <table class="table table-sm">
        <thead>
          <tr>
            <th>名称</th>
            <th>文件夹</th>
            <th>主群组</th>
            <th>触发模式</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${groups.map(g => `
            <tr>
              <td>${escapeHtml(g.name)}</td>
              <td>${escapeHtml(g.folder)}</td>
              <td>${g.is_main ? '<span class="badge bg-primary">主</span>' : ''}</td>
              <td><code>${escapeHtml(g.trigger_pattern || '-')}</code></td>
              <td>
                <button class="btn btn-sm btn-outline-primary" onclick="loadGroupSkills('${escapeHtml(g.folder)}')">Skills</button>
                <button class="btn btn-sm btn-outline-secondary" onclick="loadGroupMemory('${escapeHtml(g.folder)}')">Memory</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    bodyDiv.innerHTML = `<div class="alert alert-warning">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadGroupSkills(folder) {
  const bodyDiv = document.getElementById('skillsBody');

  // Expand the skills section
  const skillsSection = document.getElementById('skillsSection');
  const bsCollapse = new bootstrap.Collapse(skillsSection, { toggle: true });

  bodyDiv.innerHTML = '<div class="spinner-border spinner-border-sm"></div> 加载中...';

  try {
    const result = await api.getSkills(currentInstanceId, folder);
    if (!result.success) {
      bodyDiv.innerHTML = `<div class="alert alert-warning">加载失败: ${escapeHtml(result.error)}</div>`;
      return;
    }

    const skills = result.skills;
    const cachedBadge = result.cached
      ? '<span class="badge bg-secondary ms-2">缓存</span>'
      : '<span class="badge bg-success ms-2">实时</span>';

    if (!skills || skills.length === 0) {
      bodyDiv.innerHTML = '<div class="text-muted">暂无 Skills</div>';
      return;
    }

    bodyDiv.innerHTML = `
      <h6>群组 ${escapeHtml(folder)} 的 Skills ${cachedBadge}</h6>
      <div class="accordion accordion-flush">
        ${skills.map((s, i) => `
          <div class="accordion-item">
            <h2 class="accordion-header">
              <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#skill-${i}">
                ${escapeHtml(s.name)}
              </button>
            </h2>
            <div id="skill-${i}" class="accordion-collapse collapse">
              <div class="accordion-body">
                <pre>${escapeHtml(s.content || '(空)')}</pre>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    bodyDiv.innerHTML = `<div class="alert alert-warning">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadGroupMemory(folder) {
  const bodyDiv = document.getElementById('memoryBody');

  // Expand the memory section
  const memorySection = document.getElementById('memorySection');
  const bsCollapse = new bootstrap.Collapse(memorySection, { toggle: true });

  bodyDiv.innerHTML = '<div class="spinner-border spinner-border-sm"></div> 加载中...';

  try {
    const result = await api.getMemory(currentInstanceId, folder);
    if (!result.success) {
      bodyDiv.innerHTML = `<div class="alert alert-warning">加载失败: ${escapeHtml(result.error)}</div>`;
      return;
    }

    const memory = result.memory;
    const cachedBadge = result.cached
      ? '<span class="badge bg-secondary ms-2">缓存</span>'
      : '<span class="badge bg-success ms-2">实时</span>';

    if (!memory || memory.length === 0) {
      bodyDiv.innerHTML = '<div class="text-muted">暂无 Memory 文件</div>';
      return;
    }

    bodyDiv.innerHTML = `
      <h6>群组 ${escapeHtml(folder)} 的 Memory ${cachedBadge}</h6>
      <div class="accordion accordion-flush">
        ${memory.map((m, i) => `
          <div class="accordion-item">
            <h2 class="accordion-header">
              <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#memory-${i}">
                ${escapeHtml(m.filename)}
              </button>
            </h2>
            <div id="memory-${i}" class="accordion-collapse collapse">
              <div class="accordion-body memory-content">
                <pre>${escapeHtml(m.content || '(空)')}</pre>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    bodyDiv.innerHTML = `<div class="alert alert-warning">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

function getStatusClass(status) {
  switch (status) {
    case 'running':
      return 'status-running';
    case 'idle':
      return 'status-idle';
    case 'error':
      return 'status-error';
    default:
      return 'status-offline';
  }
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}