// Dashboard page logic
(async function initDashboard() {
  // Check authentication
  await auth.requireAuth();

  // Setup logout button
  document.getElementById('logoutBtn').addEventListener('click', () => {
    auth.logout();
  });

  // Load instances
  loadInstances();
})();

async function loadInstances() {
  const grid = document.getElementById('instancesGrid');

  try {
    const result = await api.getInstances();
    if (!result.success) {
      grid.innerHTML = `<div class="col-12"><div class="alert alert-danger">加载失败: ${result.error}</div></div>`;
      return;
    }

    const instances = result.instances;

    if (instances.length === 0) {
      grid.innerHTML = `<div class="col-12"><div class="alert alert-info">暂无连接的实例</div></div>`;
      return;
    }

    grid.innerHTML = instances.map(inst => createInstanceCard(inst)).join('');

    // Add click handlers
    grid.querySelectorAll('.instance-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.instanceId;
        window.location.href = `/instance?id=${id}`;
      });
    });
  } catch (err) {
    grid.innerHTML = `<div class="col-12"><div class="alert alert-danger">加载失败: ${err.message}</div></div>`;
  }
}

function createInstanceCard(instance) {
  const statusClass = getStatusClass(instance.status);
  const connectionBadge = instance.connected
    ? '<span class="badge bg-success connection-badge">已连接</span>'
    : '<span class="badge bg-secondary connection-badge">离线</span>';

  const lastHeartbeat = instance.last_heartbeat
    ? formatTime(instance.last_heartbeat)
    : '未知';

  const channels = instance.channels || [];
  const channelsHtml = channels.length > 0
    ? `<div class="channels-list text-muted">频道: ${escapeHtml(channels.join(', '))}</div>`
    : '';

  return `
    <div class="col-md-4 col-lg-3">
      <div class="card instance-card" data-instance-id="${escapeHtml(instance.instance_id)}">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <h5 class="card-title">${escapeHtml(instance.hostname || instance.instance_id)}</h5>
            <span class="badge ${statusClass}">${escapeHtml(instance.status || '未知')}</span>
          </div>
          <div class="mb-2">
            <small class="text-muted">ID: ${escapeHtml(instance.instance_id)}</small>
          </div>
          <div class="mb-2">
            ${connectionBadge}
          </div>
          <div class="mb-2">
            <small class="text-muted">最后心跳: ${escapeHtml(lastHeartbeat)}</small>
          </div>
          ${channelsHtml}
        </div>
      </div>
    </div>
  `;
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}