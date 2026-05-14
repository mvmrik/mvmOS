// ── Settings window ──────────────────────────────────────────────────────────

const Settings = (() => {

  // All IANA timezones grouped by region
  const TIMEZONES = [
    "UTC",
    "Europe/Sofia", "Europe/London", "Europe/Paris", "Europe/Berlin",
    "Europe/Rome", "Europe/Madrid", "Europe/Amsterdam", "Europe/Brussels",
    "Europe/Vienna", "Europe/Warsaw", "Europe/Prague", "Europe/Budapest",
    "Europe/Bucharest", "Europe/Athens", "Europe/Istanbul", "Europe/Moscow",
    "Europe/Kiev", "Europe/Helsinki", "Europe/Stockholm", "Europe/Oslo",
    "Europe/Copenhagen", "Europe/Zurich", "Europe/Lisbon",
    "America/New_York", "America/Chicago", "America/Denver",
    "America/Los_Angeles", "America/Anchorage", "America/Honolulu",
    "America/Toronto", "America/Vancouver", "America/Sao_Paulo",
    "America/Argentina/Buenos_Aires", "America/Mexico_City", "America/Bogota",
    "America/Lima", "America/Santiago", "America/Caracas",
    "Asia/Dubai", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok",
    "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo",
    "Asia/Seoul", "Asia/Karachi", "Asia/Tashkent", "Asia/Almaty",
    "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Vladivostok",
    "Asia/Riyadh", "Asia/Tehran", "Asia/Beirut", "Asia/Jerusalem",
    "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos", "Africa/Nairobi",
    "Africa/Casablanca", "Africa/Tunis",
    "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane",
    "Australia/Perth", "Pacific/Auckland", "Pacific/Fiji",
  ];

  const LANGUAGES = [
    { value: "en", label: "English" },
    { value: "bg", label: "Български" },
    { value: "de", label: "Deutsch" },
    { value: "fr", label: "Français" },
    { value: "es", label: "Español" },
    { value: "it", label: "Italiano" },
    { value: "ru", label: "Русский" },
    { value: "tr", label: "Türkçe" },
    { value: "zh", label: "中文" },
    { value: "ja", label: "日本語" },
    { value: "ar", label: "العربية" },
  ];

  let currentSettings = {};

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings');
      currentSettings = await res.json();
    } catch (_) {
      currentSettings = {};
    }
    return currentSettings;
  }

  // Display settings are per-device — stored in localStorage only
  const DISPLAY_KEY = 'mvmos_display';

  function loadDisplay() {
    try { return JSON.parse(localStorage.getItem(DISPLAY_KEY)) || {}; } catch (_) { return {}; }
  }

  function saveDisplay(data) {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(data));
    applyDisplay(data);
    window.dispatchEvent(new CustomEvent('display-changed', { detail: data }));
  }

  // icon_size: 1-5, default 3
  const ICON_WIDTHS  = ['48px', '62px', '76px', '96px', '120px'];
  const ICON_FONTS   = ['1.3rem', '1.65rem', '2rem', '2.5rem', '3.1rem'];
  const ICON_LABELS  = ['0.62rem', '0.68rem', '0.75rem', '0.85rem', '0.95rem'];
  // text_size: 1-5, default 3
  const TEXT_SCALES  = ['11px', '12.5px', '14px', '15.5px', '17px'];

  function applyDisplay(d) {
    const iIdx = Math.min(Math.max((parseInt(d.icon_size) || 3) - 1, 0), 4);
    const tIdx = Math.min(Math.max((parseInt(d.text_size) || 3) - 1, 0), 4);

    document.documentElement.style.setProperty('--icon-width',      ICON_WIDTHS[iIdx]);
    document.documentElement.style.setProperty('--icon-emoji-size', ICON_FONTS[iIdx]);
    document.documentElement.style.setProperty('--icon-label-size', ICON_LABELS[iIdx]);
    document.documentElement.style.setProperty('--icon-gap',        ['4px','6px','8px','10px','12px'][iIdx]);
    document.documentElement.style.fontSize = TEXT_SCALES[tIdx];
  }

  async function saveSettings(data) {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: data }),
    });
    currentSettings = data;
    // notify other modules
    window.dispatchEvent(new CustomEvent('settings-changed', { detail: data }));
  }

  const FM_PREFS_KEY = 'mvmos_fm_prefs';
  function loadFMPrefs() {
    try { return JSON.parse(localStorage.getItem(FM_PREFS_KEY)) || {}; } catch (_) { return {}; }
  }
  function saveFMPrefs(p) {
    localStorage.setItem(FM_PREFS_KEY, JSON.stringify(p));
    window.dispatchEvent(new CustomEvent('fm-prefs-changed', { detail: p }));
  }

  function openWindow(tab) {
    if (document.querySelector('.window[data-win-id="settings"]')) {
      Desktop.focusWindow('settings');
      if (tab) switchTab(tab);
      return;
    }
    Desktop.createWindow({
      id: 'settings',
      title: '⚙️ Settings',
      width: 620,
      height: 480,
      onMount(body) {
        loadSettings().then(s => render(body, s, tab));
      },
    });
    Desktop.focusWindow('settings');
  }

  function switchTab(tab) {
    const body = document.querySelector('.window[data-win-id="settings"] .window-body');
    if (!body) return;
    body.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    body.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
    const tabEl = body.querySelector(`.settings-tab[data-tab="${tab}"]`);
    const panEl = body.querySelector(`#sp-${tab}`);
    if (tabEl) tabEl.classList.add('active');
    if (panEl) panEl.classList.add('active');
  }

  function render(body, s, activeTab) {
    activeTab = activeTab || 'display';
    const d = loadDisplay();
    const fm = loadFMPrefs();
    body.style.overflow = 'hidden';
    body.style.padding = '0';
    body.innerHTML = `
      <div class="settings-wrap">

        <nav class="settings-tabs">
          <div class="settings-tab ${activeTab==='display'?'active':''}" data-tab="display">🖥️ Display</div>
          <div class="settings-tab ${activeTab==='regional'?'active':''}" data-tab="regional">🌐 Regional</div>
          <div class="settings-tab ${activeTab==='filemanager'?'active':''}" data-tab="filemanager">📁 File Manager</div>
          <div class="settings-tab ${activeTab==='users'?'active':''}" data-tab="users">👥 Users</div>
          <div class="settings-tab ${activeTab==='updates'?'active':''}" data-tab="updates">🔄 Updates</div>
          <div class="settings-tab ${activeTab==='about'?'active':''}" data-tab="about" style="margin-top:auto">ℹ️ About</div>
        </nav>

        <div class="settings-panels">

          <!-- Display panel -->
          <div class="settings-panel ${activeTab==='display'?'active':''}" id="sp-display">
            <div class="settings-section">
              <div class="settings-section-title">🖥️ Display <span style="font-size:.7rem;color:#666;font-weight:400;text-transform:none;letter-spacing:0">(saved per device)</span></div>

              <div class="settings-row settings-row-slider">
                <label>Icon Size</label>
                <div class="slider-wrap">
                  <input type="range" id="s-icon-size" min="1" max="5" step="1" value="${parseInt(d.icon_size) || 3}">
                  <div class="slider-labels"><span>XS</span><span>S</span><span>M</span><span>L</span><span>XL</span></div>
                </div>
                <span class="slider-preview-icon" id="prev-icon">🖥️</span>
              </div>

              <div class="settings-row settings-row-slider">
                <label>Text Size</label>
                <div class="slider-wrap">
                  <input type="range" id="s-text-size" min="1" max="5" step="1" value="${parseInt(d.text_size) || 3}">
                  <div class="slider-labels"><span>XS</span><span>S</span><span>M</span><span>L</span><span>XL</span></div>
                </div>
                <span class="slider-preview-text" id="prev-text">Aa</span>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-section-title">🎨 Theme</div>
              <div id="theme-picker-wrap" style="display:flex;flex-wrap:wrap;gap:10px;padding:4px 0">
                <div style="color:var(--text-dim);font-size:.83rem">Loading themes…</div>
              </div>
              <div style="margin-top:10px">
                <button class="s-btn-sm" id="s-open-theme-store">Browse Themes in App Store</button>
              </div>
            </div>

          </div>

          <!-- Regional panel -->
          <div class="settings-panel ${activeTab==='regional'?'active':''}" id="sp-regional">
            <div class="settings-section">
              <div class="settings-section-title">🕐 Date &amp; Time</div>

              <div class="settings-row">
                <label>Time Zone</label>
                <select id="s-timezone">
                  ${TIMEZONES.map(tz =>
                    `<option value="${tz}" ${s.timezone === tz ? 'selected' : ''}>${tz.replace('_', ' ')}</option>`
                  ).join('')}
                </select>
              </div>

              <div class="settings-row">
                <label>Time Format</label>
                <div class="settings-radio-group">
                  <label class="radio-opt">
                    <input type="radio" name="time_format" value="24" ${s.time_format !== '12' ? 'checked' : ''}>
                    <span>24-hour &nbsp;<span class="preview-time" id="prev-24"></span></span>
                  </label>
                  <label class="radio-opt">
                    <input type="radio" name="time_format" value="12" ${s.time_format === '12' ? 'checked' : ''}>
                    <span>12-hour &nbsp;<span class="preview-time" id="prev-12"></span></span>
                  </label>
                </div>
              </div>

              <div class="settings-row">
                <label>Show date in taskbar</label>
                <input type="checkbox" id="s-show-date" ${s.show_date ? 'checked' : ''} style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer;">
              </div>

              <div class="settings-row">
                <label>Date Format</label>
                <select id="s-date-format">
                  <option value="DD/MM/YYYY" ${s.date_format === 'DD/MM/YYYY' ? 'selected' : ''}>DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY" ${s.date_format === 'MM/DD/YYYY' ? 'selected' : ''}>MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD" ${s.date_format === 'YYYY-MM-DD' ? 'selected' : ''}>YYYY-MM-DD</option>
                </select>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-section-title">📅 Calendar</div>

              <div class="settings-row">
                <label>Week Starts On</label>
                <div class="settings-radio-group">
                  <label class="radio-opt">
                    <input type="radio" name="week_starts" value="monday" ${s.week_starts !== 'sunday' ? 'checked' : ''}>
                    <span>Monday</span>
                  </label>
                  <label class="radio-opt">
                    <input type="radio" name="week_starts" value="sunday" ${s.week_starts === 'sunday' ? 'checked' : ''}>
                    <span>Sunday</span>
                  </label>
                </div>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-section-title">🌐 Language &amp; Region</div>

              <div class="settings-row">
                <label>Language</label>
                <select id="s-language">
                  ${LANGUAGES.map(l =>
                    `<option value="${l.value}" ${s.language === l.value ? 'selected' : ''}>${l.label}</option>`
                  ).join('')}
                </select>
              </div>
            </div>

          </div>

          <!-- Users panel -->
          <div class="settings-panel ${activeTab==='users'?'active':''}" id="sp-users">
            <div id="users-content"><div class="settings-section-title" style="padding:16px 0 0 2px">Loading…</div></div>
          </div>

          <!-- File Manager panel -->
          <div class="settings-panel ${activeTab==='filemanager'?'active':''}" id="sp-filemanager">
            <div class="settings-section">
              <div class="settings-section-title">📁 File Manager</div>

              <div class="settings-row">
                <label>Show hidden files</label>
                <input type="checkbox" id="s-fm-hidden" ${fm.showHidden ? 'checked' : ''} style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer;">
              </div>
              <div class="settings-row">
                <label>Show permissions</label>
                <input type="checkbox" id="s-fm-perms" ${fm.showPerms ? 'checked' : ''} style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer;">
              </div>
              <div class="settings-row">
                <label>Show owner</label>
                <input type="checkbox" id="s-fm-owner" ${fm.showOwner ? 'checked' : ''} style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer;">
              </div>
            </div>
          </div>

          <!-- Updates panel -->
          <div class="settings-panel ${activeTab==='updates'?'active':''}" id="sp-updates" style="padding:0;overflow:hidden"></div>

          <!-- About panel -->
          <div class="settings-panel ${activeTab==='about'?'active':''}" id="sp-about">
            <div id="about-content" style="padding:8px 0"><div style="color:var(--text-dim);font-size:.85rem">Loading…</div></div>
          </div>

        </div>
      </div>
    `;

    updateTimePreviews();
    setInterval(updateTimePreviews, 10000);

    // tab switching
    body.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        body.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        body.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        body.querySelector(`#sp-${tab.dataset.tab}`).classList.add('active');
        if (tab.dataset.tab === 'users') renderUsers(body);
        if (tab.dataset.tab === 'updates') renderUpdates(body);
        if (tab.dataset.tab === 'about') renderAbout(body);
        if (tab.dataset.tab === 'display') renderThemePicker(body);
      });
    });

    if (activeTab === 'users') renderUsers(body);
    if (activeTab === 'updates') renderUpdates(body);
    if (activeTab === 'about') renderAbout(body);
    if (activeTab === 'display' || !activeTab) renderThemePicker(body);

    // Display — auto-save on slider change
    const iconSlider = body.querySelector('#s-icon-size');
    const textSlider = body.querySelector('#s-text-size');
    const prevIcon   = body.querySelector('#prev-icon');
    const prevText   = body.querySelector('#prev-text');

    const ICON_FONT_PREVIEW = ['1.1rem','1.4rem','1.8rem','2.3rem','2.9rem'];
    const TEXT_PREVIEW      = ['11px','12.5px','14px','15.5px','17px'];

    iconSlider.addEventListener('input', () => {
      const i = parseInt(iconSlider.value) - 1;
      prevIcon.style.fontSize = ICON_FONT_PREVIEW[i];
      saveDisplay({ icon_size: iconSlider.value, text_size: textSlider.value });
    });
    textSlider.addEventListener('input', () => {
      const i = parseInt(textSlider.value) - 1;
      prevText.style.fontSize = TEXT_PREVIEW[i];
      saveDisplay({ icon_size: iconSlider.value, text_size: textSlider.value });
    });

    prevIcon.style.fontSize = ICON_FONT_PREVIEW[parseInt(iconSlider.value) - 1];
    prevText.style.fontSize = TEXT_PREVIEW[parseInt(textSlider.value) - 1];

    // Regional — auto-save on any change (debounced for selects)
    let regionalTimer;
    const saveRegional = () => {
      clearTimeout(regionalTimer);
      regionalTimer = setTimeout(() => {
        saveSettings({
          timezone:    body.querySelector('#s-timezone').value,
          time_format: body.querySelector('input[name="time_format"]:checked').value,
          date_format: body.querySelector('#s-date-format').value,
          show_date:   body.querySelector('#s-show-date').checked,
          week_starts: body.querySelector('input[name="week_starts"]:checked').value,
          language:    body.querySelector('#s-language').value,
        });
      }, 400);
    };
    body.querySelector('#s-timezone').addEventListener('change', saveRegional);
    body.querySelector('#s-date-format').addEventListener('change', saveRegional);
    body.querySelectorAll('input[name="time_format"]').forEach(el => el.addEventListener('change', saveRegional));
    body.querySelectorAll('input[name="week_starts"]').forEach(el => el.addEventListener('change', saveRegional));
    body.querySelector('#s-show-date').addEventListener('change', saveRegional);
    body.querySelector('#s-language').addEventListener('change', saveRegional);

    // File Manager — instant
    body.querySelector('#s-fm-hidden').addEventListener('change', e => {
      saveFMPrefs({ ...loadFMPrefs(), showHidden: e.target.checked });
    });
    body.querySelector('#s-fm-perms').addEventListener('change', e => {
      saveFMPrefs({ ...loadFMPrefs(), showPerms: e.target.checked });
    });
    body.querySelector('#s-fm-owner').addEventListener('change', e => {
      saveFMPrefs({ ...loadFMPrefs(), showOwner: e.target.checked });
    });
  }

  async function renderUsers(body) {
    const container = body.querySelector('#users-content');
    container.innerHTML = '<div style="padding:12px 0;color:var(--text-dim);font-size:.85rem">Loading…</div>';

    let data;
    try {
      const res = await fetch('/api/users');
      data = await res.json();
    } catch (_) {
      container.innerHTML = '<div style="color:#e05555;padding:12px 0">Failed to load users.</div>';
      return;
    }

    const { users, groups } = data;

    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">System Users</div>
        <div class="users-list" id="users-list"></div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">Add New User</div>
        <div class="settings-row"><label>Username</label><input class="s-input" id="nu-name" placeholder="username"></div>
        <div class="settings-row"><label>Password</label><input class="s-input" id="nu-pass" type="password" placeholder="password"></div>
        <div class="settings-row"><label>Shell</label>
          <select class="s-input" id="nu-shell">
            <option value="/bin/bash">/bin/bash</option>
            <option value="/bin/sh">/bin/sh</option>
            <option value="/usr/sbin/nologin">nologin</option>
          </select>
        </div>
        <div class="settings-row"><label>Groups</label><input class="s-input" id="nu-groups" placeholder="sudo,www-data (comma separated)"></div>
        <div class="settings-row">
          <label></label>
          <button class="s-btn" id="nu-add">Create User</button>
          <span id="nu-msg" style="font-size:.8rem;margin-left:8px"></span>
        </div>
      </div>
    `;

    const listEl = container.querySelector('#users-list');
    users.forEach(u => {
      const row = document.createElement('div');
      row.className = 'user-row';
      row.innerHTML = `
        <div class="user-row-main">
          <span class="user-name">${u.username}</span>
          <span class="user-uid">uid:${u.uid}</span>
          <span class="user-shell">${u.shell}</span>
          <button class="s-btn-sm user-edit-btn">Edit</button>
          ${u.username !== 'root' ? `<button class="s-btn-sm s-btn-danger user-del-btn">Delete</button>` : ''}
        </div>
        <div class="user-edit-panel" style="display:none">
          <div class="settings-row" style="margin-top:8px">
            <label>Groups</label>
            <div class="user-groups-wrap">
              ${groups.map(g => `
                <label class="user-group-opt">
                  <input type="checkbox" value="${g}" ${u.groups.includes(g) ? 'checked' : ''}> ${g}
                </label>`).join('')}
            </div>
          </div>
          <div class="settings-row">
            <label>Shell</label>
            <select class="s-input user-shell-sel">
              ${['/bin/bash','/bin/sh','/usr/sbin/nologin'].map(sh =>
                `<option ${u.shell===sh?'selected':''}>${sh}</option>`).join('')}
            </select>
          </div>
          <div class="settings-row">
            <label>New Password</label>
            <input class="s-input user-pass-inp" type="password" placeholder="leave blank to keep">
          </div>
          <div class="settings-row">
            <label></label>
            <button class="s-btn user-save-btn">Save</button>
            <span class="user-save-msg" style="font-size:.8rem;margin-left:8px"></span>
          </div>
        </div>
      `;

      row.querySelector('.user-edit-btn').addEventListener('click', () => {
        const panel = row.querySelector('.user-edit-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      });

      if (u.username !== 'root') {
        row.querySelector('.user-del-btn').addEventListener('click', async () => {
          if (!confirm(`Delete user "${u.username}"? This will remove their home directory.`)) return;
          const r = await fetch(`/api/users/${u.username}`, { method: 'DELETE' });
          if (r.ok) renderUsers(body);
          else { const e = await r.json(); alert(e.detail); }
        });
      }

      row.querySelector('.user-save-btn').addEventListener('click', async () => {
        const checkedGroups = [...row.querySelectorAll('.user-groups-wrap input:checked')].map(i => i.value);
        const shell    = row.querySelector('.user-shell-sel').value;
        const password = row.querySelector('.user-pass-inp').value;
        const payload  = { groups: checkedGroups, shell };
        if (password) payload.password = password;

        const r = await fetch(`/api/users/${u.username}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const msg = row.querySelector('.user-save-msg');
        if (r.ok) {
          msg.style.color = '#50fa7b'; msg.textContent = '✓ Saved';
          setTimeout(() => renderUsers(body), 800);
        } else {
          const e = await r.json();
          msg.style.color = '#e05555'; msg.textContent = e.detail;
        }
      });

      listEl.appendChild(row);
    });

    // create user
    container.querySelector('#nu-add').addEventListener('click', async () => {
      const username = container.querySelector('#nu-name').value.trim();
      const password = container.querySelector('#nu-pass').value;
      const shell    = container.querySelector('#nu-shell').value;
      const groups   = container.querySelector('#nu-groups').value.split(',').map(g => g.trim()).filter(Boolean);
      const msg      = container.querySelector('#nu-msg');

      if (!username || !password) { msg.style.color='#e05555'; msg.textContent='Username and password required'; return; }

      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, shell, groups }),
      });
      if (r.ok) {
        msg.style.color = '#50fa7b'; msg.textContent = '✓ User created';
        container.querySelector('#nu-name').value = '';
        container.querySelector('#nu-pass').value = '';
        container.querySelector('#nu-groups').value = '';
        setTimeout(() => renderUsers(body), 800);
      } else {
        const e = await r.json();
        msg.style.color = '#e05555'; msg.textContent = e.detail;
      }
    });
  }

  function updateTimePreviews() {
    const now = new Date();
    const el24 = document.getElementById('prev-24');
    const el12 = document.getElementById('prev-12');
    if (el24) el24.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    if (el12) el12.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function initDisplay() {
    applyDisplay(loadDisplay());
  }

  async function get() {
    if (Object.keys(currentSettings).length === 0) await loadSettings();
    return currentSettings;
  }

  function renderUpdates(body) {
    const panel = body.querySelector('#sp-updates');
    if (!panel || panel._rendered) return;
    panel._rendered = true;
    UpdateManager.render(panel);
  }

  async function renderAbout(body) {
    const wrap = body.querySelector('#about-content');
    if (!wrap) return;
    wrap.innerHTML = '<div style="color:var(--text-dim);font-size:.85rem">Loading…</div>';

    const res  = await fetch('/api/system/info');
    const info = await res.json();

    wrap.innerHTML = `
      <div class="settings-section">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
          <div style="font-size:2.6rem;line-height:1">🖥️</div>
          <div>
            <div style="font-size:1.15rem;font-weight:700;color:var(--text)">mvmOS</div>
            <div style="font-size:.82rem;color:var(--text-dim)">Version ${info.version} &nbsp;·&nbsp; <span style="font-family:monospace">${info.commit}</span> (${info.branch})</div>
          </div>
        </div>

        <div class="about-grid">
          <span class="about-label">Hostname</span><span class="about-val">${info.hostname}</span>
          <span class="about-label">Kernel</span><span class="about-val">${info.kernel}</span>
          <span class="about-label">Uptime</span><span class="about-val">${info.uptime}</span>
          <span class="about-label">Memory</span><span class="about-val">${info.mem_used} / ${info.mem_total}</span>
          <span class="about-label">Disk (/)</span><span class="about-val">${info.disk_used} / ${info.disk_total} (${info.disk_pct})</span>
        </div>
      </div>

      <div class="settings-section" style="margin-top:16px">
        <div class="settings-section-title">⬆️ System Update</div>
        <div style="margin-bottom:10px">
          <button class="s-btn" id="about-check-btn">Check for updates</button>
          <span id="about-update-status" style="margin-left:10px;font-size:.82rem;color:var(--text-dim)"></span>
        </div>
        <div id="about-update-output" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:10px;font-size:.78rem;font-family:monospace;max-height:180px;overflow-y:auto;white-space:pre-wrap"></div>
        <button class="s-btn" id="about-update-btn" style="display:none;margin-top:8px">↑ Apply update &amp; restart</button>
        <div id="about-update-manual" style="display:none;margin-top:8px;font-size:.8rem;color:var(--text-dim)">
          SSH грешка — изпълни ръчно в терминала:<br>
          <code id="about-update-cmd" style="display:block;margin-top:4px;padding:6px 8px;background:var(--surface);border-radius:4px;color:var(--text);font-size:.78rem;word-break:break-all"></code>
          <button class="s-btn" id="about-update-copy-btn" style="margin-top:6px;font-size:.75rem">📋 Copy command</button>
          <button class="s-btn" id="about-update-terminal-btn" style="margin-top:6px;margin-left:6px;font-size:.75rem">⬛ Open in Terminal</button>
        </div>
      </div>
    `;

    const checkBtn  = wrap.querySelector('#about-check-btn');
    const statusEl  = wrap.querySelector('#about-update-status');
    const updateBtn = wrap.querySelector('#about-update-btn');
    const outputEl  = wrap.querySelector('#about-update-output');
    const manualEl  = wrap.querySelector('#about-update-manual');
    const cmdEl     = wrap.querySelector('#about-update-cmd');
    const copyBtn   = wrap.querySelector('#about-update-copy-btn');
    const termBtn   = wrap.querySelector('#about-update-terminal-btn');

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(cmdEl.textContent).then(() => { copyBtn.textContent = '✓ Copied!'; setTimeout(() => { copyBtn.textContent = '📋 Copy command'; }, 2000); });
    });
    termBtn.addEventListener('click', () => {
      Terminal.openWindow();
      setTimeout(() => document.dispatchEvent(new CustomEvent('terminal-run', { detail: cmdEl.textContent })), 500);
    });

    async function doCheck(silent) {
      checkBtn.disabled = true;
      if (!silent) statusEl.textContent = 'Checking…';
      try {
        const r = await fetch('/api/system/check-update');
        const d = await r.json();
        if (d.error) { statusEl.style.color = '#f38ba8'; statusEl.textContent = d.error; return; }
        if (d.up_to_date) {
          if (!silent) { statusEl.style.color = '#50fa7b'; statusEl.textContent = '✓ Already up to date'; }
          updateBtn.style.display = 'none';
        } else {
          statusEl.style.color = '#f1fa8c';
          statusEl.textContent = `New version available: ${d.local} → ${d.remote}`;
          updateBtn.style.display = '';
          if (d.notes) {
            outputEl.style.display = 'block';
            outputEl.textContent = d.notes;
          }
        }
      } catch (_) {
        if (!silent) { statusEl.style.color = '#f38ba8'; statusEl.textContent = 'Check failed.'; }
      } finally {
        checkBtn.disabled = false;
      }
    }

    checkBtn.addEventListener('click', () => doCheck(false));
    // auto-check silently when About tab opens
    doCheck(true);

    updateBtn.addEventListener('click', async () => {
      updateBtn.disabled = true;
      outputEl.style.display = 'block';
      outputEl.textContent = '';
      statusEl.textContent = 'Updating…';

      const res = await fetch('/api/system/update', { method: 'POST' });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const text = line.slice(6);
          if (text === '__RESTARTING__') {
            outputEl.textContent += '\nRestarting server…';
            statusEl.style.color = '#50fa7b';
            statusEl.textContent = '✓ Update applied — reconnecting…';
            setTimeout(() => location.reload(), 3000);
          } else if (text.startsWith('__EXIT_')) {
            statusEl.style.color = '#f38ba8';
            statusEl.textContent = '✗ Update failed';
            updateBtn.disabled = false;
            const repoDir = outputEl.dataset.repoDir || window.location.origin;
            cmdEl.textContent = `cd $(systemctl show mvmos -p WorkingDirectory --value) && git pull origin main && sudo systemctl restart mvmos`;
            manualEl.style.display = 'block';
          } else {
            outputEl.textContent += text + '\n';
            outputEl.scrollTop = outputEl.scrollHeight;
          }
        }
      }
    });
  }

  async function renderThemePicker(body) {
    const wrap = body.querySelector('#theme-picker-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div style="color:var(--text-dim);font-size:.83rem">Loading…</div>';

    let themes;
    try {
      const res = await fetch('/api/themes');
      themes = await res.json();
    } catch (_) {
      wrap.innerHTML = '<div style="color:#e05555;font-size:.83rem">Failed to load themes.</div>';
      return;
    }

    if (!themes.length) {
      wrap.innerHTML = '<div style="color:var(--text-dim);font-size:.83rem">No themes installed. Browse the App Store to install themes.</div>';
    } else {
      wrap.innerHTML = themes.map(t => `
        <div class="theme-card ${t.is_active ? 'active' : ''}" data-id="${t.id}" title="${t.description}" style="
          display:flex;flex-direction:column;align-items:center;gap:6px;
          background:var(--surface2);border:2px solid ${t.is_active ? 'var(--accent)' : 'var(--border)'};
          border-radius:8px;padding:12px 10px;width:90px;cursor:pointer;transition:border-color .15s;text-align:center">
          <span style="font-size:1.6rem;line-height:1">${t.icon}</span>
          <span style="font-size:.75rem;color:var(--text);font-weight:600;word-break:break-word">${t.name}</span>
          ${t.is_active ? '<span style="font-size:.67rem;color:var(--accent)">✓ Active</span>' : ''}
        </div>
      `).join('');

      wrap.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', async () => {
          if (card.classList.contains('active')) return;
          await mvmOS._applyTheme(card.dataset.id);
          renderThemePicker(body);
        });
      });
    }

    const storeBtn = body.querySelector('#s-open-theme-store');
    if (storeBtn) {
      storeBtn.onclick = () => AppStore.openWindow({ section: 'themes' });
    }
  }

  return { openWindow, get, initDisplay, loadFMPrefs };
})();
