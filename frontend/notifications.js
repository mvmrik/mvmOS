const Notifications = (() => {
  function _t(k, vars) { return window.t ? window.t(k, vars) : k; }

  function _dateKey(iso) {
    return new Date(iso).toISOString().slice(0, 10);
  }

  function _dateLabel(key) {
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);
    if (key === todayKey) return _t('notif_today');
    if (key === yesterdayKey) return _t('notif_yesterday');
    return new Date(key).toLocaleDateString(window.mvmOS?.lang || undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function _timeLabel(iso) {
    return new Date(iso).toLocaleTimeString(window.mvmOS?.lang || undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function openWindow() {
    Desktop.createWindow({
      id: 'notifications',
      title: '🔔 ' + _t('app_notifications'),
      width: 460,
      height: 560,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'notifications' }); },
      onMount(body) {
        body.style.cssText = 'padding:0;display:flex;flex-direction:column;height:100%;background:var(--surface);color:var(--text);font-family:inherit';
        body.innerHTML = `
          <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select id="nf-status" class="s-input" style="width:auto;font-size:.8rem">
              <option value="all">${_t('notif_status_all')}</option>
              <option value="unread">${_t('notif_status_unread')}</option>
              <option value="read">${_t('notif_status_read')}</option>
            </select>
            <select id="nf-type" class="s-input" style="width:auto;font-size:.8rem">
              <option value="all">${_t('notif_type_all')}</option>
              <option value="persistent">${_t('notif_type_persistent')}</option>
              <option value="push">${_t('notif_type_push')}</option>
            </select>
            <div style="margin-left:auto;display:flex;gap:6px">
              <button id="nf-mark-all" class="s-btn s-btn-sm">${_t('notif_mark_all_read')}</button>
              <button id="nf-delete-all" class="s-btn s-btn-sm s-btn-danger">${_t('notif_delete_all')}</button>
            </div>
          </div>
          <div id="nf-list" style="flex:1;overflow-y:auto;padding:4px 0"></div>`;

        let all = [];

        async function load() {
          const list = body.querySelector('#nf-list');
          list.innerHTML = `<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>`;
          const res = await fetch('/api/notifications', { headers: mvmOS._pubHeaders() }).catch(() => null);
          if (!res || !res.ok) { list.innerHTML = `<div style="padding:20px;color:#ef4444">Error loading</div>`; return; }
          all = await res.json();
          render();
        }

        function render() {
          const list = body.querySelector('#nf-list');
          const status = body.querySelector('#nf-status').value;
          const type = body.querySelector('#nf-type').value;
          let items = all;
          if (status === 'unread') items = items.filter(n => !n.is_read);
          if (status === 'read') items = items.filter(n => n.is_read);
          if (type !== 'all') items = items.filter(n => n.kind === type);

          if (!items.length) {
            list.innerHTML = `<div class="notif-empty">${_t('notif_empty')}</div>`;
            return;
          }

          const groups = new Map();
          items.forEach(n => {
            const key = _dateKey(n.created_at);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(n);
          });

          list.innerHTML = [...groups.entries()].map(([key, rows]) => `
            <div style="padding:8px 16px 4px;font-size:.72rem;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em">${_dateLabel(key)}</div>
            ${rows.map(n => `
              <div class="nf-row${n.is_read ? '' : ' nf-row-unread'}" data-id="${n.id}" style="display:flex;gap:10px;align-items:flex-start;padding:10px 16px;border-bottom:1px solid var(--border);cursor:${mvmOS._hasNotifAction?.(n.id, n.action_app) ? 'pointer' : 'default'}">
                <div style="width:8px;height:8px;border-radius:50%;background:${n.is_read ? 'transparent' : 'var(--accent)'};margin-top:6px;flex-shrink:0"></div>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="font-weight:600;font-size:.87rem">${n.title}</span>
                    ${n.kind === 'push' ? `<span class="notif-type-badge">${_t('notif_push_badge')}</span>` : ''}
                  </div>
                  ${n.body ? `<div style="color:var(--text-dim);font-size:.8rem;margin-top:2px">${n.body}</div>` : ''}
                  <div style="color:var(--text-dim);font-size:.7rem;margin-top:4px">${_timeLabel(n.created_at)}</div>
                </div>
                <div class="nf-delete" data-id="${n.id}" title="${_t('notif_delete')}" style="color:var(--text-dim);cursor:pointer;flex-shrink:0;padding:2px 4px">✕</div>
              </div>`).join('')}
          `).join('');

          list.querySelectorAll('.nf-row').forEach(row => {
            row.addEventListener('click', async e => {
              if (e.target.closest('.nf-delete')) return;
              const id = parseInt(row.dataset.id);
              const n = all.find(x => x.id === id);
              if (!n) return;
              if (!n.is_read) {
                await fetch(`/api/notifications/${id}/read`, { method: 'POST', headers: mvmOS._pubHeaders() });
                n.is_read = 1;
                mvmOS._refreshNotifs?.();
                render();
              }
              if (mvmOS._hasNotifAction?.(n.id, n.action_app)) mvmOS._runNotifAction?.(n.id, n.action_app);
            });
          });
          list.querySelectorAll('.nf-delete').forEach(el => {
            el.addEventListener('click', async e => {
              e.stopPropagation();
              const id = parseInt(el.dataset.id);
              await fetch(`/api/notifications/${id}`, { method: 'DELETE', headers: mvmOS._pubHeaders() });
              all = all.filter(n => n.id !== id);
              mvmOS._refreshNotifs?.();
              render();
            });
          });
        }

        body.querySelector('#nf-status').addEventListener('change', render);
        body.querySelector('#nf-type').addEventListener('change', render);
        body.querySelector('#nf-mark-all').addEventListener('click', async () => {
          await fetch('/api/notifications/read-all', { method: 'POST', headers: mvmOS._pubHeaders() });
          all.forEach(n => n.is_read = 1);
          mvmOS._refreshNotifs?.();
          render();
        });
        body.querySelector('#nf-delete-all').addEventListener('click', async () => {
          const ok = await mvmOS.confirm(_t('notif_delete_all_confirm'));
          if (!ok) return;
          await fetch('/api/notifications', { method: 'DELETE', headers: mvmOS._pubHeaders() });
          all = [];
          mvmOS._refreshNotifs?.();
          render();
        });

        load();
      },
    });
  }

  return { openWindow };
})();
