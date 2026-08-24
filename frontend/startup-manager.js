const StartupManager = (() => {
  function _t(k) { return window.t ? window.t('su_' + k) : k; }

  function openWindow() {
    Desktop.createWindow({
      id: 'startup-manager',
      title: '🚀 ' + _t('title'),
      width: 480,
      height: 520,
      onMount(body) {
        body.style.cssText = 'padding:0;display:flex;flex-direction:column;height:100%;background:var(--surface);color:var(--text);font-family:inherit';
        body.innerHTML = `
          <div style="padding:16px 20px 10px;border-bottom:1px solid var(--border)">
            <div style="font-size:.8rem;color:var(--text-dim)">${_t('desc')}</div>
          </div>
          <div id="sm-list" style="flex:1;overflow-y:auto;padding:8px 0"></div>`;

        async function load() {
          const list = body.querySelector('#sm-list');
          list.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
          const res = await fetch('/api/startup').catch(() => null);
          if (!res || !res.ok) { list.innerHTML = `<div style="padding:20px;color:#ef4444">${_t('error_loading')}</div>`; return; }
          const apps = await res.json();
          if (!apps.length) { list.innerHTML = `<div style="padding:20px;color:var(--text-dim);font-size:.85rem">${_t('no_apps')}</div>`; return; }

          list.innerHTML = apps.map(a => `
            <div class="sm-row" data-id="${a.id}" style="display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid var(--border);cursor:pointer">
              <div style="flex:1;min-width:0">
                <div style="font-size:.88rem;font-weight:500">${a.name || a.id}</div>
                <div style="font-size:.72rem;color:var(--text-dim);margin-top:2px">${a.enabled ? _t('enabled') : _t('disabled')}</div>
              </div>
              <div class="sm-toggle" style="position:relative;width:40px;height:22px;flex-shrink:0">
                <div class="sm-track" style="position:absolute;inset:0;border-radius:22px;background:${a.enabled ? 'var(--accent)' : 'var(--border)'};transition:.2s"></div>
                <div class="sm-knob" style="position:absolute;top:3px;left:${a.enabled ? '21px' : '3px'};width:16px;height:16px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>
              </div>
            </div>`).join('');

          list.querySelectorAll('.sm-row').forEach(row => {
            const id = row.dataset.id;
            row.addEventListener('click', async () => {
              const r = await fetch(`/api/startup/${id}`, { method: 'POST' }).catch(() => null);
              if (!r?.ok) return;
              const d = await r.json();
              const track = row.querySelector('.sm-track');
              const knob  = row.querySelector('.sm-knob');
              const label = row.querySelector('div > div:last-child');
              track.style.background = d.enabled ? 'var(--accent)' : 'var(--border)';
              knob.style.left = d.enabled ? '21px' : '3px';
              label.textContent = d.enabled ? _t('enabled') : _t('disabled');
            });
          });
        }

        load();
      },
    });
  }

  return { openWindow };
})();
