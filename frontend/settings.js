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
      title: `⚙️ ${t('app_settings')}`,
      width: 620,
      height: 480,
      onMount(body) {
        Promise.all([loadSettings(), window.mvmOS?.i18nReady || Promise.resolve()]).then(([s]) => {
          render(body, s, tab);
          Desktop.initMobileSidebar(body);
        });
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
      <div class="settings-wrap as-wrap">

        <nav class="settings-tabs as-sidebar">
          <div class="settings-tab ${activeTab==='display'?'active':''}" data-tab="display">${t('settings_display')}</div>
          <div class="settings-tab ${activeTab==='screensaver'?'active':''}" data-tab="screensaver">${t('settings_screensaver')}</div>
          <div class="settings-tab ${activeTab==='regional'?'active':''}" data-tab="regional">${t('settings_regional')}</div>
          <div class="settings-tab ${activeTab==='filemanager'?'active':''}" data-tab="filemanager">${t('settings_filemanager')}</div>
          <div class="settings-tab ${activeTab==='users'?'active':''}" data-tab="users">${t('settings_users')}</div>
          <div class="settings-tab ${activeTab==='updates'?'active':''}" data-tab="updates">${t('settings_updates')}</div>
          <div class="settings-tab ${activeTab==='startmenu'?'active':''}" data-tab="startmenu">${t('settings_startmenu')}</div>
          <div class="settings-tab ${activeTab==='about'?'active':''}" data-tab="about" style="margin-top:auto">${t('settings_about')}</div>
        </nav>

        <div class="settings-panels as-main">

          <!-- Display panel -->
          <div class="settings-panel ${activeTab==='display'?'active':''}" id="sp-display">
            <div class="settings-section">
              <div class="settings-section-title">${t('display_title')} <span style="font-size:.7rem;color:#666;font-weight:400;text-transform:none;letter-spacing:0">${t('display_per_device')}</span></div>

              <div class="settings-row settings-row-slider">
                <label>${t('display_icon_size')}</label>
                <div class="slider-wrap">
                  <input type="range" id="s-icon-size" min="1" max="5" step="1" value="${parseInt(d.icon_size) || 3}">
                  <div class="slider-labels"><span>${t('display_size_xs')}</span><span>${t('display_size_s')}</span><span>${t('display_size_m')}</span><span>${t('display_size_l')}</span><span>${t('display_size_xl')}</span></div>
                </div>
                <span class="slider-preview-icon" id="prev-icon">🖥️</span>
              </div>

              <div class="settings-row settings-row-slider">
                <label>${t('display_text_size')}</label>
                <div class="slider-wrap">
                  <input type="range" id="s-text-size" min="1" max="5" step="1" value="${parseInt(d.text_size) || 3}">
                  <div class="slider-labels"><span>${t('display_size_xs')}</span><span>${t('display_size_s')}</span><span>${t('display_size_m')}</span><span>${t('display_size_l')}</span><span>${t('display_size_xl')}</span></div>
                </div>
                <span class="slider-preview-text" id="prev-text">Aa</span>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-section-title">🔄 ${t('display_widget_refresh')}</div>
              <div class="settings-row">
                <label>${t('display_widget_refresh')}</label>
                <div style="display:flex;align-items:center;gap:8px">
                  <input type="number" id="s-widget-refresh" min="1" value="${parseInt(d.widget_refresh) || 3}"
                    style="width:70px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.85rem">
                  <span style="color:var(--text-dim);font-size:.82rem">${t('display_widget_refresh_sec')}</span>
                </div>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-section-title">🎨 Theme</div>
              <div id="theme-picker-wrap" style="display:flex;flex-wrap:wrap;gap:10px;padding:4px 0">
                <div style="color:var(--text-dim);font-size:.83rem">Loading themes…</div>
              </div>
              <div style="margin-top:10px">
                <button class="s-btn-sm" id="s-open-theme-store">${t('tstore_browse')}</button>
              </div>
            </div>

            <div class="settings-section" style="border-top:1px solid var(--border);padding-top:16px">
              <div class="settings-section-title">${t('display_mobile')}</div>
              <div class="settings-row">
                <label>${t('display_single_click')}</label>
                <input type="checkbox" id="s-single-click" ${(d.single_click !== false) ? 'checked' : ''}>
              </div>
            </div>

          </div>

          <!-- Regional panel -->
          <div class="settings-panel ${activeTab==='regional'?'active':''}" id="sp-regional">
            <div class="settings-section">
              <div class="settings-section-title">🕐 Date &amp; Time</div>

              <div class="settings-row">
                <label>${t('regional_timezone')}</label>
                <select id="s-timezone">
                  ${TIMEZONES.map(tz =>
                    `<option value="${tz}" ${s.timezone === tz ? 'selected' : ''}>${tz.replace('_', ' ')}</option>`
                  ).join('')}
                </select>
              </div>

              <div class="settings-row">
                <label>${t('regional_time_format')}</label>
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
                <label>${t('regional_show_date')}</label>
                <input type="checkbox" id="s-show-date" ${s.show_date ? 'checked' : ''} style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer;">
              </div>

              <div class="settings-row">
                <label>${t('regional_date_format')}</label>
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
                <label>${t('regional_week_starts')}</label>
                <div class="settings-radio-group">
                  <label class="radio-opt">
                    <input type="radio" name="week_starts" value="monday" ${s.week_starts !== 'sunday' ? 'checked' : ''}>
                    <span>${t('regional_monday')}</span>
                  </label>
                  <label class="radio-opt">
                    <input type="radio" name="week_starts" value="sunday" ${s.week_starts === 'sunday' ? 'checked' : ''}>
                    <span>${t('regional_sunday')}</span>
                  </label>
                </div>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-section-title">🌐 Language &amp; Region</div>

              <div class="settings-row">
                <label>${t('regional_language')}</label>
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
            <div id="users-content"><div class="settings-section-title" style="padding:16px 0 0 2px">${t('loading')}</div></div>
          </div>

          <!-- File Manager panel -->
          <div class="settings-panel ${activeTab==='filemanager'?'active':''}" id="sp-filemanager">
            <div class="settings-section">
              <div class="settings-section-title">${t('fm_title')}</div>

              <div class="settings-row">
                <label>${t('fm_show_hidden')}</label>
                <input type="checkbox" id="s-fm-hidden" ${fm.showHidden ? 'checked' : ''} style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer;">
              </div>
              <div class="settings-row">
                <label>${t('fm_show_permissions')}</label>
                <input type="checkbox" id="s-fm-perms" ${fm.showPerms ? 'checked' : ''} style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer;">
              </div>
              <div class="settings-row">
                <label>${t('fm_show_owner')}</label>
                <input type="checkbox" id="s-fm-owner" ${fm.showOwner ? 'checked' : ''} style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer;">
              </div>
              <div class="settings-row">
                <label>${t('fm_trash_ask')}</label>
                <input type="checkbox" id="s-fm-trash-ask" ${fm.trashAsk !== false ? 'checked' : ''} style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer;">
              </div>
              <div class="settings-row">
                <label>${t('fm_trash_auto_days_label')}</label>
                <select id="s-fm-trash-days" style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);cursor:pointer;">
                  <option value="0"  ${(fm.trashDays||30)==0  ?'selected':''}>${t('fm_trash_auto_never')}</option>
                  <option value="7"  ${(fm.trashDays||30)==7  ?'selected':''}>${t('fm_trash_auto_7')}</option>
                  <option value="14" ${(fm.trashDays||30)==14 ?'selected':''}>${t('fm_trash_auto_14')}</option>
                  <option value="30" ${(fm.trashDays||30)==30 ?'selected':''}>${t('fm_trash_auto_30')}</option>
                  <option value="60" ${(fm.trashDays||30)==60 ?'selected':''}>${t('fm_trash_auto_60')}</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Updates panel -->
          <div class="settings-panel ${activeTab==='updates'?'active':''}" id="sp-updates" style="padding:0;overflow:hidden"></div>

          <!-- Start Menu panel -->
          <div class="settings-panel ${activeTab==='startmenu'?'active':''}" id="sp-startmenu"></div>

          <!-- Screen Saver panel -->
          <div class="settings-panel ${activeTab==='screensaver'?'active':''}" id="sp-screensaver">
            <div class="settings-section">
              <div class="settings-section-title">${t('ss_title')}</div>
              <div class="settings-row">
                <span>${t('ss_timeout')}</span>
                <select id="ss-timeout">
                  <option value="0">${t('ss_off')}</option>
                  <option value="1">1 ${t('ss_min')}</option>
                  <option value="5">5 ${t('ss_min')}</option>
                  <option value="10">10 ${t('ss_min')}</option>
                  <option value="30">30 ${t('ss_min')}</option>
                </select>
              </div>
              <div class="settings-row">
                <span>${t('ss_require_password')}</span>
                <label class="toggle"><input type="checkbox" id="ss-password"><span class="toggle-slider"></span></label>
              </div>
            </div>
            <div class="settings-section">
              <div class="settings-section-title">${t('ss_type')}</div>
              <div id="ss-accordion" style="display:flex;flex-direction:column;gap:6px"></div>
            </div>
            <div style="margin-top:4px;padding:0 2px">
              <button class="settings-btn" id="ss-preview">${t('ss_preview')}</button>
            </div>
          </div>

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
        if (tab.dataset.tab === 'startmenu') renderStartMenu(body);
        if (tab.dataset.tab === 'screensaver') initScreenSaver(body);
      });
    });

    if (activeTab === 'users') renderUsers(body);
    if (activeTab === 'updates') renderUpdates(body);
    if (activeTab === 'about') renderAbout(body);
    if (activeTab === 'display' || !activeTab) renderThemePicker(body);
    if (activeTab === 'startmenu') renderStartMenu(body);
    if (activeTab === 'screensaver') initScreenSaver(body);

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

    const refreshInput = body.querySelector('#s-widget-refresh');
    if (refreshInput) {
      refreshInput.addEventListener('change', () => {
        const val = Math.max(1, parseInt(refreshInput.value) || 3);
        refreshInput.value = val;
        saveSettings({ widget_refresh: val });
      });
    }

    const singleClick = body.querySelector('#s-single-click');
    if (singleClick) {
      singleClick.addEventListener('change', () => {
        saveSettings({ single_click: singleClick.checked });
      });
    }

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
    body.querySelector('#s-fm-trash-ask').addEventListener('change', e => {
      saveFMPrefs({ ...loadFMPrefs(), trashAsk: e.target.checked });
    });
    body.querySelector('#s-fm-trash-days').addEventListener('change', e => {
      saveFMPrefs({ ...loadFMPrefs(), trashDays: parseInt(e.target.value) });
    });
  }

  async function renderUsers(body) {
    const container = body.querySelector('#users-content');
    container.innerHTML = `<div style="padding:12px 0;color:var(--text-dim);font-size:.85rem">${t('loading')}</div>`;

    let data;
    try {
      const res = await fetch('/api/users');
      data = await res.json();
    } catch (_) {
      container.innerHTML = `<div style="color:#e05555;padding:12px 0">${t('users_failed')}</div>`;
      return;
    }

    const { users, groups } = data;

    container.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">${t('users_title')}</div>
        <div class="users-list" id="users-list"></div>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">${t('users_add_title')}</div>
        <div class="settings-row"><label>${t('users_username')}</label><input class="s-input" id="nu-name" placeholder="${t('users_username_ph')}"></div>
        <div class="settings-row"><label>${t('users_password')}</label><input class="s-input" id="nu-pass" type="password" placeholder="${t('users_password2_ph')}"></div>
        <div class="settings-row"><label>${t('users_shell')}</label>
          <select class="s-input" id="nu-shell">
            <option value="/bin/bash">/bin/bash</option>
            <option value="/bin/sh">/bin/sh</option>
            <option value="/usr/sbin/nologin">nologin</option>
          </select>
        </div>
        <div class="settings-row"><label>${t('users_groups')}</label><input class="s-input" id="nu-groups" placeholder="${t('users_groups_ph')}"></div>
        <div class="settings-row">
          <label></label>
          <button class="s-btn" id="nu-add">${t('users_create')}</button>
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
          <button class="s-btn-sm user-edit-btn">${t('users_edit')}</button>
          ${u.username !== 'root' ? `<button class="s-btn-sm s-btn-danger user-del-btn">${t('users_delete')}</button>` : ''}
        </div>
        <div class="user-edit-panel" style="display:none">
          <div class="settings-row" style="margin-top:8px">
            <label>${t('users_groups')}</label>
            <div class="user-groups-wrap">
              ${groups.map(g => `
                <label class="user-group-opt">
                  <input type="checkbox" value="${g}" ${u.groups.includes(g) ? 'checked' : ''}> ${g}
                </label>`).join('')}
            </div>
          </div>
          <div class="settings-row">
            <label>${t('users_shell')}</label>
            <select class="s-input user-shell-sel">
              ${['/bin/bash','/bin/sh','/usr/sbin/nologin'].map(sh =>
                `<option ${u.shell===sh?'selected':''}>${sh}</option>`).join('')}
            </select>
          </div>
          <div class="settings-row">
            <label>${t('users_new_password')}</label>
            <input class="s-input user-pass-inp" type="password" placeholder="${t('users_password_ph')}">
          </div>
          <div class="settings-row">
            <label></label>
            <button class="s-btn user-save-btn">${t('users_save')}</button>
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
          msg.style.color = '#50fa7b'; msg.textContent = t('users_saved');
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

      if (!username || !password) { msg.style.color='#e05555'; msg.textContent=t('users_req_fields'); return; }

      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, shell, groups }),
      });
      if (r.ok) {
        msg.style.color = '#50fa7b'; msg.textContent = t('users_created');
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
    wrap.innerHTML = `<div style="color:var(--text-dim);font-size:.85rem">${t('loading')}</div>`;

    await (window.mvmOS?.i18nReady || Promise.resolve());
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
          <span class="about-label">${t('about_hostname')}</span><span class="about-val">${info.hostname}</span>
          <span class="about-label">${t('about_kernel')}</span><span class="about-val">${info.kernel}</span>
          <span class="about-label">${t('about_uptime')}</span><span class="about-val">${info.uptime}</span>
          <span class="about-label">${t('about_memory')}</span><span class="about-val">${info.mem_used} / ${info.mem_total}</span>
          <span class="about-label">${t('about_disk')}</span><span class="about-val">${info.disk_used} / ${info.disk_total} (${info.disk_pct})</span>
        </div>
      </div>

      <div class="settings-section" style="margin-top:16px">
        <div class="settings-section-title">${t('about_system_update')}</div>
        <div style="margin-bottom:10px">
          <button class="s-btn" id="about-check-btn">${t('um_check')}</button>
          <span id="about-update-status" style="margin-left:10px;font-size:.82rem;color:var(--text-dim)"></span>
        </div>
        <div id="about-update-output" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:10px;font-size:.78rem;font-family:monospace;max-height:180px;overflow-y:auto;white-space:pre-wrap"></div>
        <button class="s-btn" id="about-update-btn" style="display:none;margin-top:8px">${t('about_apply_update')}</button>
        <div id="about-update-manual" style="display:none;margin-top:8px;font-size:.8rem;color:var(--text-dim)">
          ${t('about_ssh_error')}<br>
          <code id="about-update-cmd" style="display:block;margin-top:4px;padding:6px 8px;background:var(--surface);border-radius:4px;color:var(--text);font-size:.78rem;word-break:break-all"></code>
          <button class="s-btn" id="about-update-copy-btn" style="margin-top:6px;font-size:.75rem">${t('about_copy_cmd')}</button>
          <button class="s-btn" id="about-update-terminal-btn" style="margin-top:6px;margin-left:6px;font-size:.75rem">${t('about_open_terminal')}</button>
        </div>
      </div>

      <div class="settings-section" style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px">
        <div class="settings-section-title" style="color:#e05555">${t('uninstall_title')}</div>
        <div style="font-size:.82rem;color:var(--text-dim);margin-bottom:12px">${t('uninstall_desc')}</div>
        <div style="display:flex;flex-direction:column;gap:8px;max-width:340px">
          <button id="uninstall-btn" class="s-btn s-btn-danger">${t('uninstall_btn')}</button>
          <div id="uninstall-status" style="display:none"></div>
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
      navigator.clipboard.writeText(cmdEl.textContent).then(() => { copyBtn.textContent = t('about_copied'); setTimeout(() => { copyBtn.textContent = t('about_copy_cmd'); }, 2000); });
    });
    termBtn.addEventListener('click', () => {
      Terminal.openWindow();
      setTimeout(() => document.dispatchEvent(new CustomEvent('terminal-run', { detail: cmdEl.textContent })), 500);
    });

    async function doCheck(silent) {
      checkBtn.disabled = true;
      if (!silent) statusEl.textContent = t('users_checking');
      try {
        const r = await fetch('/api/system/check-update');
        const d = await r.json();
        if (d.error) { statusEl.style.color = '#f38ba8'; statusEl.textContent = d.error; return; }
        if (d.up_to_date) {
          if (!silent) { statusEl.style.color = '#50fa7b'; statusEl.textContent = t('about_up_to_date'); }
          updateBtn.style.display = 'none';
        } else {
          statusEl.style.color = '#f1fa8c';
          statusEl.textContent = t('about_new_version', { local: d.local, remote: d.remote });
          updateBtn.style.display = '';
          if (d.notes) {
            outputEl.style.display = 'block';
            outputEl.textContent = d.notes;
          }
        }
      } catch (_) {
        if (!silent) { statusEl.style.color = '#f38ba8'; statusEl.textContent = t('about_check_failed'); }
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
      statusEl.textContent = t('about_updating');

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
            outputEl.textContent += '\n' + t('about_restarting');
            statusEl.style.color = '#50fa7b';
            statusEl.textContent = t('about_update_applied');
            _showRestartingOverlay();
          } else if (text.startsWith('__EXIT_')) {
            statusEl.style.color = '#f38ba8';
            statusEl.textContent = t('about_update_failed');
            updateBtn.disabled = false;
            const repoDir = outputEl.dataset.repoDir || window.location.origin;
            cmdEl.textContent = `curl -fsSL https://github.com/mvmrik/mvmOS/archive/refs/heads/main.tar.gz | sudo tar -xz --strip-components=1 -C $(systemctl show mvmos -p WorkingDirectory --value) --exclude='*/venv' --exclude='*/backend/mvmos.db' && sudo systemctl restart mvmos`;
            manualEl.style.display = 'block';
          } else {
            outputEl.textContent += text + '\n';
            outputEl.scrollTop = outputEl.scrollHeight;
          }
        }
      }
    });

    const uninstallBtn    = wrap.querySelector('#uninstall-btn');
    const uninstallStatus = wrap.querySelector('#uninstall-status');

    const uninstallCmd = 'sudo systemctl disable --now mvmos mvmos-public ; sudo rm -f /etc/systemd/system/mvmos.service /etc/systemd/system/mvmos-public.service ; sudo systemctl daemon-reload ; sudo rm -f /etc/sudoers.d/mvmos ; sudo userdel mvmos ; sudo groupdel mvmos ; sudo rm -rf /opt/mvmos';
    uninstallBtn.addEventListener('click', () => {
      uninstallStatus.style.display = '';
      uninstallStatus.innerHTML = `${t('uninstall_run_cmd')}<br>
        <code style="display:block;margin-top:6px;padding:8px;background:var(--surface);border-radius:4px;font-size:.75rem;word-break:break-all;color:var(--text)">${uninstallCmd}</code>
        <button id="uninstall-copy-btn" class="s-btn" style="margin-top:6px;font-size:.75rem">${t('about_copy_cmd')}</button>`;
      uninstallStatus.querySelector('#uninstall-copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(uninstallCmd).then(() => {
          uninstallStatus.querySelector('#uninstall-copy-btn').textContent = t('about_copied');
        });
      });
    });
  }

  function _showRestartingOverlay() {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:#fff;font-family:inherit';
    ov.innerHTML = `
      <div style="font-size:2rem">⟳</div>
      <div style="font-size:1.1rem;font-weight:600" id="ov-msg">${t('about_restarting')}</div>
      <div style="font-size:.85rem;color:#aaa" id="ov-sub">...</div>
    `;
    document.body.appendChild(ov);
    const msg = ov.querySelector('#ov-msg');
    const sub = ov.querySelector('#ov-sub');
    let dots = 0;
    const tick = setInterval(() => { dots = (dots + 1) % 4; sub.textContent = '.'.repeat(dots + 1); }, 500);
    setTimeout(() => { clearInterval(tick); location.reload(); }, 10000);
  }

  async function renderThemePicker(body) {
    const wrap = body.querySelector('#theme-picker-wrap');
    if (!wrap) return;
    wrap.innerHTML = `<div style="color:var(--text-dim);font-size:.83rem">${t('loading')}</div>`;

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

  // ── Start Menu settings ───────────────────────────────────────────────────
  const SM_KEY = 'mvmos_start_menu';

  function loadStartMenuPrefs() {
    try { return JSON.parse(localStorage.getItem(SM_KEY)); } catch (_) { return null; }
  }

  function saveStartMenuPrefs(prefs) {
    localStorage.setItem(SM_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent('startmenu-changed', { detail: prefs }));
  }

  function defaultStartMenuPrefs() {
    return {
      order: ['recent', 'frequent', 'custom'],
      recent: 0,
      frequent: 0,
      custom: [],
    };
  }

  function renderStartMenu(body) {
    const panel = body.querySelector('#sp-startmenu');
    if (!panel) return;
    const prefs = loadStartMenuPrefs() || defaultStartMenuPrefs();
    const allApps = Object.values(window.mvmOS?._apps || {}).sort((a, b) => a.name.localeCompare(b.name));

    function _saveAndRedraw() { saveStartMenuPrefs(prefs); _draw(); }

    function _blockLabel(id) {
      return id === 'recent' ? t('sm_recent') : id === 'frequent' ? t('sm_frequent') : t('sm_custom');
    }

    function _draw() {
      panel.innerHTML = `<div style="padding:4px 0">` + prefs.order.map((blockId, idx) => {
        const isFirst = idx === 0, isLast = idx === prefs.order.length - 1;
        let inner = '';

        if (blockId === 'recent' || blockId === 'frequent') {
          const val = prefs[blockId];
          const dedup = prefs[blockId + '_dedup'] || false;
          inner = `<div style="display:flex;align-items:center;gap:10px;margin-top:8px">
            <label style="color:var(--text-dim);font-size:.82rem">${t('sm_show_last')}</label>
            <select data-count="${blockId}" style="background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px 8px;font-size:.82rem">
              ${[0,1,2,3,4,5,6,7,8,10].map(n => `<option value="${n}"${val===n?' selected':''}>${n === 0 ? t('sm_hidden') : n}</option>`).join('')}
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            <input type="checkbox" id="dedup-${blockId}" data-dedup="${blockId}" ${dedup?'checked':''} style="cursor:pointer">
            <label for="dedup-${blockId}" style="color:var(--text-dim);font-size:.82rem;cursor:pointer">${t('sm_dedup')}</label>
          </div>`;
        } else {
          // custom block
          inner = `<div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">
            ${prefs.custom.map((appId, i) => {
              const app = window.mvmOS?._apps?.[appId];
              if (!app) return '';
              return `<div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:5px 8px">
                <span>${app.icon}</span>
                <span style="flex:1;font-size:.82rem">${app.name}</span>
                <button data-remove="${appId}" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:.85rem;padding:0 4px">✕</button>
              </div>`;
            }).join('')}
            <select data-add-custom style="margin-top:4px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px 8px;font-size:.82rem">
              <option value="">${t('sm_add_app')}</option>
              ${allApps.filter(a => !prefs.custom.includes(a.id)).map(a => `<option value="${a.id}">${a.icon} ${a.name}</option>`).join('')}
            </select>
          </div>`;
        }

        return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px 14px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-weight:600;font-size:.84rem;flex:1">${_blockLabel(blockId)}</span>
            <button data-up="${idx}" ${isFirst?'disabled':''} style="background:none;border:1px solid var(--border);border-radius:4px;color:var(--text-dim);cursor:pointer;padding:2px 7px;font-size:.8rem${isFirst?';opacity:.3':''}">↑</button>
            <button data-down="${idx}" ${isLast?'disabled':''} style="background:none;border:1px solid var(--border);border-radius:4px;color:var(--text-dim);cursor:pointer;padding:2px 7px;font-size:.8rem${isLast?';opacity:.3':''}">↓</button>
          </div>
          ${inner}
        </div>`;
      }).join('') + `</div>`;

      // events
      panel.querySelectorAll('[data-count]').forEach(sel => {
        sel.addEventListener('change', () => {
          prefs[sel.dataset.count] = parseInt(sel.value);
          _saveAndRedraw();
        });
      });
      panel.querySelectorAll('[data-dedup]').forEach(chk => {
        chk.addEventListener('change', () => {
          prefs[chk.dataset.dedup + '_dedup'] = chk.checked;
          _saveAndRedraw();
        });
      });
      panel.querySelectorAll('[data-up]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = parseInt(btn.dataset.up);
          if (i > 0) { [prefs.order[i-1], prefs.order[i]] = [prefs.order[i], prefs.order[i-1]]; _saveAndRedraw(); }
        });
      });
      panel.querySelectorAll('[data-down]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = parseInt(btn.dataset.down);
          if (i < prefs.order.length - 1) { [prefs.order[i], prefs.order[i+1]] = [prefs.order[i+1], prefs.order[i]]; _saveAndRedraw(); }
        });
      });
      panel.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          prefs.custom = prefs.custom.filter(id => id !== btn.dataset.remove);
          _saveAndRedraw();
        });
      });
      panel.querySelectorAll('[data-add-custom]').forEach(sel => {
        sel.addEventListener('change', () => {
          if (sel.value) { prefs.custom.push(sel.value); _saveAndRedraw(); }
        });
      });
    }

    _draw();
  }

  function initScreenSaver(body) {
    const timeoutSel = body.querySelector('#ss-timeout');
    const passwordChk = body.querySelector('#ss-password');
    const previewBtn = body.querySelector('#ss-preview');
    const accordion = body.querySelector('#ss-accordion');
    if (!timeoutSel) return;

    timeoutSel.value = localStorage.getItem('ss_timeout') ?? '5';
    passwordChk.checked = localStorage.getItem('ss_password') === '1';
    timeoutSel.addEventListener('change', () => {
      localStorage.setItem('ss_timeout', timeoutSel.value);
      ScreenSaver.applyTimeout(parseInt(timeoutSel.value));
    });
    passwordChk.addEventListener('change', () => {
      localStorage.setItem('ss_password', passwordChk.checked ? '1' : '0');
    });
    if (previewBtn) previewBtn.addEventListener('click', () => ScreenSaver.activate());

    // ── Screensaver type accordion ──────────────────────────────────────────
    accordion.innerHTML = '';
    const activeType = localStorage.getItem('ss_type') || 'logo';

    const types = [
      { id: 'logo',   label: t('ss_type_logo'),   icon: '🖥' },
      { id: 'photos', label: t('ss_type_photos'),  icon: '🖼' },
    ];

    types.forEach(tp => {
      const isActive = activeType === tp.id;
      const item = document.createElement('div');
      item.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius);overflow:hidden';
      item.innerHTML = `
        <div class="ss-acc-header" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;background:${isActive ? 'var(--accent-dim, rgba(99,102,241,.12))' : 'var(--surface)'}">
          <span style="font-size:1.1rem">${tp.icon}</span>
          <span style="flex:1;font-size:.9rem;font-weight:500">${tp.label}</span>
          ${isActive ? `<span style="font-size:.75rem;color:var(--accent);font-weight:600">${t('ss_active')}</span>` : `<button class="s-btn s-btn-sm ss-select-btn">${t('ss_select')}</button>`}
        </div>
        <div class="ss-acc-body" style="display:${tp.id === 'photos' && isActive ? 'block' : (tp.id === 'logo' ? 'none' : 'none')};padding:10px 14px;border-top:1px solid var(--border);background:var(--bg)"></div>
      `;

      const header = item.querySelector('.ss-acc-header');
      const bodyEl = item.querySelector('.ss-acc-body');
      const selectBtn = item.querySelector('.ss-select-btn');

      if (tp.id === 'photos') {
        _buildPhotosSettings(bodyEl);
      }

      if (selectBtn) {
        selectBtn.addEventListener('click', e => {
          e.stopPropagation();
          localStorage.setItem('ss_type', tp.id);
          initScreenSaver(body); // re-render
        });
      }

      if (tp.id === 'photos' && isActive) {
        header.addEventListener('click', () => {
          bodyEl.style.display = bodyEl.style.display === 'none' ? 'block' : 'none';
        });
      }

      accordion.appendChild(item);
    });
  }

  function _buildPhotosSettings(container) {
    const folder = localStorage.getItem('ss_photos_folder') || '';
    const period = localStorage.getItem('ss_photos_period') || '5';
    container.innerHTML = `
      <div class="settings-row" style="margin-bottom:8px">
        <span style="font-size:.85rem">${t('ss_photos_folder')}</span>
        <div style="display:flex;gap:6px;flex:1;justify-content:flex-end">
          <input id="ss-photos-folder" type="text" class="s-input" style="width:160px;font-size:.82rem" placeholder="Pictures" value="${folder}">
          <button class="s-btn s-btn-sm" id="ss-folder-browse">…</button>
        </div>
      </div>
      <div class="settings-row">
        <span style="font-size:.85rem">${t('ss_photos_period')}</span>
        <select id="ss-photos-period" class="s-input" style="width:100px;font-size:.82rem">
          <option value="1">1 ${t('ss_min')}</option>
          <option value="2">2 ${t('ss_min')}</option>
          <option value="5">5 ${t('ss_min')}</option>
          <option value="10">10 ${t('ss_min')}</option>
          <option value="30">30 ${t('ss_min')}</option>
        </select>
      </div>
    `;
    container.querySelector('#ss-photos-period').value = period;

    container.querySelector('#ss-photos-folder').addEventListener('change', e => {
      localStorage.setItem('ss_photos_folder', e.target.value.trim());
    });
    container.querySelector('#ss-photos-period').addEventListener('change', e => {
      localStorage.setItem('ss_photos_period', e.target.value);
    });
    container.querySelector('#ss-folder-browse').addEventListener('click', async () => {
      const input = container.querySelector('#ss-photos-folder');
      const res = await fetch('/api/auth/whoami');
      const me = await res.json();
      const home = `/home/${me.effective_user}`;
      const path = prompt(t('ss_photos_folder_prompt') || 'Subfolder in your home directory (e.g. Pictures):', input.value || '');
      if (path !== null) {
        input.value = path.trim();
        localStorage.setItem('ss_photos_folder', path.trim());
      }
    });
  }

  return { openWindow, get, initDisplay, loadFMPrefs, loadStartMenuPrefs, defaultStartMenuPrefs, initScreenSaver };
})();
