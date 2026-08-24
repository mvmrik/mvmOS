{const s=document.createElement('style');s.textContent='.cm-tab{background:none;border:none;padding:5px 12px;font-size:.82rem;color:var(--text-dim);border-radius:6px;cursor:pointer;transition:background .15s}.cm-tab:hover{background:var(--surface2)}.cm-tab-active{background:var(--surface2)!important;color:var(--text)!important;font-weight:600}';document.head.appendChild(s);}

const CronManager = (() => {
  function _t(k) { return window.t ? window.t('cron_' + k) : k; }

  let _body = null, _data = null, _me = null, _targetUser = null;
  const SHORTCUTS = ['@reboot','@hourly','@daily','@weekly','@monthly','@yearly'];
  const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function _humanSchedule(e) {
    if (e.schedule) {
      const map = {
        '@reboot': _t('at_reboot'), '@hourly': _t('every_hour'),
        '@daily': _t('every_day'), '@weekly': _t('every_week'),
        '@monthly': _t('every_month'), '@yearly': _t('every_year'),
      };
      return map[e.schedule] || e.schedule;
    }
    const m = e.minute, h = e.hour, dom = e.day, mon = e.month, dow = e.weekday;
    if (m==='*' && h==='*' && dom==='*' && mon==='*' && dow==='*') return _t('every_minute');
    if (dom==='*' && mon==='*' && dow==='*') {
      if (m==='0' && h==='*') return _t('every_hour');
      if (m!=='*' && h!=='*') return _t('daily_at') + `${h.padStart(2,'0')}:${m.padStart(2,'0')}`;
    }
    return `${m} ${h} ${dom} ${mon} ${dow}`;
  }

  let _activeTab = 'jobs';

  function openWindow() {
    Desktop.createWindow({
      id: 'cron-manager', title: '⏰ ' + t('app_cron_manager'), width: 820, height: 520,
      onMount(body) { init(body); },
    });
  }

  function init(body) {
    _body = body;
    body.style.cssText = 'padding:0;overflow:hidden;display:flex;flex-direction:column;height:100%';
    body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--border);flex-shrink:0;gap:12px">
        <div style="display:flex;gap:4px">
          <button class="cm-tab ${_activeTab==='jobs'?'cm-tab-active':''}" data-tab="jobs">${_t('tab_jobs')}</button>
          <button class="cm-tab ${_activeTab==='scheduler'?'cm-tab-active':''}" data-tab="scheduler">${_t('tab_scheduler')}</button>
        </div>
        <div id="cm-jobs-toolbar" style="display:${_activeTab==='jobs'?'flex':'none'};align-items:center;gap:8px">
          <span style="font-size:.82rem;color:var(--text-dim)">${_t('crontab_for')}</span>
          <select id="cm-user-sel" style="font-size:.82rem;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 6px;cursor:pointer"></select>
          <button class="s-btn" id="cm-add-btn">${_t('add_job')}</button>
        </div>
      </div>
      <div id="cm-content" style="flex:1;overflow-y:auto"></div>
    `;
    body.querySelectorAll('.cm-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTab = btn.dataset.tab;
        body.querySelectorAll('.cm-tab').forEach(b => b.classList.toggle('cm-tab-active', b.dataset.tab === _activeTab));
        body.querySelector('#cm-jobs-toolbar').style.display = _activeTab === 'jobs' ? 'flex' : 'none';
        if (_activeTab === 'jobs') { _load(); }
        else { _renderSchedulerTab(); }
      });
    });
    fetch('/api/cron/users').then(r => r.json()).then(users => {
      const sel = body.querySelector('#cm-user-sel');
      users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u; opt.textContent = u;
        sel.appendChild(opt);
      });
      if (_targetUser && users.includes(_targetUser)) sel.value = _targetUser;
      sel.addEventListener('change', () => { _targetUser = sel.value; _load(); });
    });
    body.querySelector('#cm-add-btn').addEventListener('click', () => _showForm(null));
    if (_activeTab === 'jobs') _load();
    else _renderSchedulerTab();
  }

  async function _renderSchedulerTab() {
    const content = _body.querySelector('#cm-content');
    content.innerHTML = `<div style="padding:24px;color:var(--text-dim);font-size:.83rem">${_t('loading')}</div>`;
    const statusData = await fetch('/api/scheduler/status').then(r => r.json());
    const isEnabled = !!statusData.cron_installed;
    const apps = statusData.apps || [];
    const systemApps = statusData.system_apps || [];
    const _bkTime = (() => { const h12 = (window._vosSettings?.time_format || '24') === '12'; return new Date(2000,0,1,3,0).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:h12}); })();
    const schedLabels = { disabled: '—', every_minute: _t('every_minute'), daily: _t('backup_sched_daily').replace('{time}',_bkTime), weekly: _t('backup_sched_weekly').replace('{time}',_bkTime), monthly: _t('backup_sched_monthly').replace('{time}',_bkTime) };
    const allRows = [
      ...apps.map(a => `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);font-size:.82rem">
          <span style="color:${a.file_exists?'#a6e3a1':'#f38ba8'}">${a.file_exists ? '✓' : '⚠'}</span>
          <span style="flex:1">${a.name}</span>
          <span style="font-family:var(--mono);font-size:.72rem;color:var(--text-dim)">${a.scheduler}${!a.file_exists?' <span style="color:#f38ba8">'+_t('scheduler_file_missing')+'</span>':''}</span>
        </div>`),
      ...systemApps.map(a => `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);font-size:.82rem">
          <span style="color:#a6e3a1">✓</span>
          <span style="flex:1">${a.name}</span>
          <span style="font-size:.72rem;color:var(--text-dim)">${schedLabels[a.config?.schedule] || '—'}</span>
        </div>`),
    ];
    content.innerHTML = `
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:.82rem;color:${isEnabled?'#a6e3a1':'var(--text-dim)'}">
          ${isEnabled ? '● ' + _t('scheduler_enabled') : '○ ' + _t('scheduler_disabled')}
        </span>
        <button class="s-btn s-btn-sm" id="cm-sched-toggle">${isEnabled ? _t('scheduler_disable') : _t('scheduler_enable')}</button>
      </div>
      ${allRows.length ? allRows.join('') : `<div style="padding:24px 16px;font-size:.83rem;color:var(--text-dim)">${_t('scheduler_no_apps')}</div>`}
    `;
    content.querySelector('#cm-sched-toggle').addEventListener('click', () => _toggleScheduler());
  }

  async function _toggleScheduler() {
    _withSudo('root', async (pwd, showErr) => {
      const res = await fetch('/api/scheduler/toggle', { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ sudo_password: pwd }) });
      if (res.ok) { _renderSchedulerTab(); }
      else { const d = await res.json().catch(() => ({})); showErr(d.detail || _t('sudo_wrong_pw')); }
    });
  }

  async function _load() {
    const content = _body.querySelector('#cm-content');
    content.innerHTML = `<div style="padding:24px;color:var(--text-dim);font-size:.83rem">${_t('loading')}</div>`;
    const url = _targetUser ? `/api/cron?user=${encodeURIComponent(_targetUser)}` : '/api/cron';
    const res = await fetch(url);
    _data = await res.json();
    _me = _data.me;
    if (!_targetUser) { _targetUser = _me; }
    const sel = _body.querySelector('#cm-user-sel');
    if (sel && sel.value !== _data.user) sel.value = _data.user;
    _render();
  }

  function _render() {
    const content = _body.querySelector('#cm-content');
    content.innerHTML = '';
    const section = document.createElement('div');
    section.style.cssText = 'padding:0 0 16px 0';
    if (!_data.entries.length) {
      section.innerHTML = `<div style="padding:24px 16px;color:var(--text-dim);font-size:.83rem">${_t('no_jobs')}</div>`;
    } else {
      section.appendChild(_makeTable(_data.entries, true));
    }
    content.appendChild(section);
    if (_data.cron_d && _data.cron_d.length) {
      const header = document.createElement('div');
      header.style.cssText = 'padding:8px 16px;border-top:1px solid var(--border);font-size:.75rem;font-weight:700;color:var(--text-dim);letter-spacing:.05em';
      header.textContent = _t('sys_jobs');
      content.appendChild(header);
      _data.cron_d.forEach(f => {
        if (!f.entries.length) return;
        const flabel = document.createElement('div');
        flabel.style.cssText = 'padding:4px 16px 2px;font-size:.75rem;color:var(--text-dim)';
        flabel.textContent = f.file;
        content.appendChild(flabel);
        content.appendChild(_makeTable(f.entries, false));
      });
    }
  }

  function _makeTable(entries, editable) {
    const wrap = document.createElement('div');
    entries.forEach(e => {
      const row = document.createElement('div');
      const disabled = e.enabled === false;
      row.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border);font-size:.8rem;${disabled ? 'opacity:.45' : ''}`;
      row.innerHTML = `
        <div style="flex:0 0 130px;color:var(--accent);font-family:var(--mono);font-size:.75rem">${_humanSchedule(e)}</div>
        <div style="flex:1;color:var(--text);font-family:var(--mono);font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.command}">${e.command}</div>
        ${editable ? `
          <button class="s-btn-sm cm-run" title="${_t('run_now')}" style="flex-shrink:0">▶</button>
          <button class="s-btn-sm ${disabled ? 's-btn' : ''} cm-toggle" title="${disabled ? _t('enable') : _t('disable')}" style="flex-shrink:0">${disabled ? '○' : '●'}</button>
          <button class="s-btn s-btn-sm cm-edit" style="flex-shrink:0">✏️</button>
          <button class="s-btn-sm s-btn-danger cm-del" style="flex-shrink:0">✕</button>
        ` : ''}
      `;
      if (editable) {
        row.querySelector('.cm-run').addEventListener('click', () => _runNow(e, row));
        row.querySelector('.cm-toggle').addEventListener('click', () => _toggle(e));
        row.querySelector('.cm-edit').addEventListener('click', () => _showForm(e));
        row.querySelector('.cm-del').addEventListener('click', () => _delete(e));
      }
      wrap.appendChild(row);
    });
    return wrap;
  }

  async function _toggle(entry) {
    const newEnabled = entry.enabled === false;
    _withSudo(_targetUser, async (pwd, showErr) => {
      const res = await fetch('/api/cron/toggle', { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ raw: entry.raw, enabled: newEnabled, target_user: _targetUser, sudo_password: pwd }) });
      const d = await res.json();
      if (res.ok) _load();
      else showErr(d.detail || _t('sudo_wrong_pw'));
    });
  }

  async function _runNow(entry, row) {
    const btn = row.querySelector('.cm-run');
    btn.disabled = true; btn.textContent = '…';
    const res = await fetch('/api/cron/run', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ command: entry.command }) });
    const d = await res.json();
    btn.disabled = false; btn.textContent = '▶';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:100';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:20px;width:520px;max-width:92%;display:flex;flex-direction:column;gap:10px';
    const output = d.output || '(no output)';
    box.innerHTML = `
      <div style="font-size:.85rem;font-weight:600;color:var(--text)">${_t('run_output')}</div>
      <div style="font-size:.73rem;color:var(--text-dim);font-family:var(--mono)">${entry.command}</div>
      <pre style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:10px;font-size:.75rem;color:${d.returncode===0?'var(--text)':'#f38ba8'};overflow:auto;max-height:220px;white-space:pre-wrap;margin:0">${_esc(output)}</pre>
      <div style="font-size:.75rem;color:var(--text-dim)">${_t('exit_code')}<span style="color:${d.returncode===0?'#a6e3a1':'#f38ba8'}">${d.returncode}</span></div>
      <div style="text-align:right"><button class="s-btn">${_t('close')}</button></div>
    `;
    box.querySelector('.s-btn').addEventListener('click', () => overlay.remove());
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    _body.appendChild(overlay);
  }

  function _esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function _withSudo(targetUser, callback) {
    if (!targetUser || targetUser === _me) {
      callback('', () => {});
      return;
    }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:110';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:20px;width:340px;max-width:90%';
    box.innerHTML = `
      <div style="font-size:.9rem;font-weight:600;margin-bottom:8px;color:var(--text)">${_t('sudo_title')}</div>
      <div style="font-size:.8rem;color:var(--text-dim);margin-bottom:14px">${_t('sudo_msg').replace('{user}', targetUser)}</div>
      <input id="sudo-pw" type="password" placeholder="${_t('sudo_placeholder')}" autocomplete="current-password"
        style="width:100%;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.85rem;box-sizing:border-box;margin-bottom:8px">
      <div id="sudo-err" style="color:#f38ba8;font-size:.78rem;margin-bottom:8px;min-height:1.2em"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="s-btn-sm" id="sudo-cancel">${_t('cancel')}</button>
        <button class="s-btn" id="sudo-ok">${_t('sudo_confirm')}</button>
      </div>
    `;
    const doConfirm = async () => {
      const pw = box.querySelector('#sudo-pw').value;
      const errEl = box.querySelector('#sudo-err');
      const okBtn = box.querySelector('#sudo-ok');
      errEl.textContent = '';
      okBtn.disabled = true;
      await callback(pw, (msg) => {
        errEl.textContent = msg;
        okBtn.disabled = false;
        box.querySelector('#sudo-pw').value = '';
        box.querySelector('#sudo-pw').focus();
      });
      if (!box.querySelector('#sudo-err').textContent) overlay.remove();
      else okBtn.disabled = false;
    };
    box.querySelector('#sudo-ok').addEventListener('click', doConfirm);
    box.querySelector('#sudo-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doConfirm(); });
    box.querySelector('#sudo-cancel').addEventListener('click', () => overlay.remove());
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    _body.appendChild(overlay);
    setTimeout(() => box.querySelector('#sudo-pw').focus(), 50);
  }

  function _showForm(entry) {
    const isEdit = !!entry, isShortcut = isEdit && !!entry.schedule;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:100';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:20px;width:480px;max-width:90%';
    box.innerHTML = `
      <div style="font-size:.9rem;font-weight:600;margin-bottom:16px;color:var(--text)">${isEdit ? _t('edit_job') : _t('new_job')}</div>
      <div style="margin-bottom:12px">
        <label style="font-size:.75rem;color:var(--text-dim);display:block;margin-bottom:4px">${_t('schedule')}</label>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <select id="cf-shortcut" style="flex:1;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.8rem">
            <option value="">${_t('custom')}</option>
            ${SHORTCUTS.map(s => `<option value="${s}" ${isShortcut && entry.schedule===s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div id="cf-fields" style="display:${isShortcut ? 'none' : 'grid'};grid-template-columns:repeat(5,1fr);gap:6px">
          ${[_t('minute'),_t('hour'),_t('day'),_t('month'),_t('weekday')].map((label, i) => {
            const keys = ['minute','hour','day','month','weekday'];
            const val = isEdit && !isShortcut ? entry[keys[i]] : '*';
            return `<div><div style="font-size:.68rem;color:var(--text-dim);margin-bottom:2px">${label}</div>
              <input class="cf-field" data-field="${keys[i]}" value="${val}" style="width:100%;padding:5px 6px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.8rem;font-family:var(--mono);box-sizing:border-box"></div>`;
          }).join('')}
        </div>
      </div>
      <div style="margin-bottom:16px">
        <label style="font-size:.75rem;color:var(--text-dim);display:block;margin-bottom:4px">${_t('command')}</label>
        <textarea id="cf-command" rows="3" placeholder="/path/to/script.sh >> /dev/null 2>&1"
          style="width:100%;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.8rem;font-family:var(--mono);box-sizing:border-box;resize:vertical;line-height:1.5">${isEdit ? entry.command.replace(/&/g,'&amp;').replace(/</g,'&lt;') : ''}</textarea>
      </div>
      <div id="cf-err" style="color:#f38ba8;font-size:.78rem;margin-bottom:8px;display:none"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="s-btn-sm" id="cf-cancel">${_t('cancel')}</button>
        <button class="s-btn" id="cf-save">${isEdit ? _t('save') : _t('add')}</button>
      </div>
    `;
    const shortcutSel = box.querySelector('#cf-shortcut'), fieldsDiv = box.querySelector('#cf-fields');
    shortcutSel.addEventListener('change', () => { fieldsDiv.style.display = shortcutSel.value ? 'none' : 'grid'; });
    box.querySelector('#cf-cancel').addEventListener('click', () => overlay.remove());
    box.querySelector('#cf-save').addEventListener('click', async () => {
      const cmd = box.querySelector('#cf-command').value.trim();
      const err = box.querySelector('#cf-err');
      if (!cmd) { err.textContent = _t('cmd_required'); err.style.display = ''; return; }
      const shortcut = shortcutSel.value, body_data = { command: cmd };
      if (shortcut) { body_data.schedule = shortcut; }
      else { box.querySelectorAll('.cf-field').forEach(f => { body_data[f.dataset.field] = f.value.trim() || '*'; }); }
      body_data.target_user = _targetUser;
      if (isEdit) body_data.old_raw = entry.raw;
      _withSudo(_targetUser, async (pwd, showErr) => {
        body_data.sudo_password = pwd;
        const res = await fetch('/api/cron', { method: isEdit ? 'PUT' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body_data) });
        const d = await res.json();
        if (res.ok) { overlay.remove(); _load(); }
        else if (res.status === 403) showErr(d.detail || _t('sudo_wrong_pw'));
        else { err.textContent = d.detail || 'Error'; err.style.display = ''; }
      });
    });
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    _body.appendChild(overlay);
    box.querySelector('#cf-command').focus();
  }

  async function _delete(entry) {
    if (!confirm(`${_t('delete_confirm')}\n\n${entry.raw}`)) return;
    _withSudo(_targetUser, async (pwd, showErr) => {
      const res = await fetch('/api/cron', { method: 'DELETE', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ raw: entry.raw, target_user: _targetUser, sudo_password: pwd }) });
      const d = await res.json();
      if (res.ok) _load();
      else showErr(d.detail || _t('sudo_wrong_pw'));
    });
  }

  return { openWindow };
})();
