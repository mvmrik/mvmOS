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

  // Fixed list — symbol-only display, never real FX conversion. Kept in
  // sync manually with apps/budget/budget-widget.js's own copy, since
  // public/Telegram app surfaces never load this file.
  const CURRENCIES = [
    { value: "EUR", label: "€ EUR — Euro" },
    { value: "USD", label: "$ USD — US Dollar" },
    { value: "GBP", label: "£ GBP — British Pound" },
    { value: "CHF", label: "CHF — Swiss Franc" },
    { value: "JPY", label: "¥ JPY — Japanese Yen" },
    { value: "CNY", label: "¥ CNY — Chinese Yuan" },
    { value: "TRY", label: "₺ TRY — Turkish Lira" },
    { value: "UAH", label: "₴ UAH — Ukrainian Hryvnia" },
    { value: "PLN", label: "zł PLN — Polish Zloty" },
    { value: "RON", label: "lei RON — Romanian Leu" },
    { value: "CZK", label: "Kč CZK — Czech Koruna" },
    { value: "HUF", label: "Ft HUF — Hungarian Forint" },
    { value: "CAD", label: "$ CAD — Canadian Dollar" },
    { value: "AUD", label: "$ AUD — Australian Dollar" },
    { value: "SEK", label: "kr SEK — Swedish Krona" },
    { value: "NOK", label: "kr NOK — Norwegian Krone" },
    { value: "DKK", label: "kr DKK — Danish Krone" },
    { value: "RUB", label: "₽ RUB — Russian Ruble" },
    { value: "INR", label: "₹ INR — Indian Rupee" },
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

  // The window body renders asynchronously, so a tab requested while it is still
  // loading is remembered here and picked up by render() instead of being lost.
  let _pendingTab = null;

  function openWindow(tab) {
    if (document.querySelector('.window[data-win-id="settings"]')) {
      Desktop.focusWindow('settings');
      if (tab) { _pendingTab = tab; switchTab(tab); }
      return;
    }
    _pendingTab = tab || null;
    Desktop.createWindow({
      id: 'settings',
      title: `⚙️ ${t('app_settings')}`,
      width: 620,
      height: 480,
      onMount(body) {
        Promise.all([loadSettings(), loadPremium(), window.mvmOS?.i18nReady || Promise.resolve()]).then(([s, premium]) => {
          render(body, s, _pendingTab || tab, premium);
          _pendingTab = null;
          Desktop.initMobileSidebar(body);
        });
      },
    });
    Desktop.focusWindow('settings');
  }

  async function loadPremium() {
    try {
      const res = await fetch('/api/premium');
      if (res.ok) return await res.json();
    } catch (_) {}
    return { status: 'free', expires_at: null, license_key_set: false, license_key_hint: '', site: '' };
  }

  function formatDate(iso, format, timezone) {
    if (!iso) return '';
    const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z';
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return iso;
    const v = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    if (format === 'MM/DD/YYYY') return `${v.month}/${v.day}/${v.year}`;
    if (format === 'YYYY-MM-DD') return `${v.year}-${v.month}-${v.day}`;
    return `${v.day}/${v.month}/${v.year}`;
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

  function render(body, s, activeTab, premium) {
    activeTab = activeTab || 'display';
    const d = loadDisplay();
    const fm = loadFMPrefs();
    premium = premium || { status: 'free', expires_at: null, license_key_set: false, license_key_hint: '', site: '' };
    const isPremium = premium.status === 'premium';
    const expiry = formatDate(premium.expires_at, s.date_format, s.timezone);
    const esc = v => String(v || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const hint = esc(premium.license_key_hint);
    const site = esc(premium.site || 'https://mvmos.org/premium');
    body.style.overflow = 'hidden';
    body.style.padding = '0';
    body.innerHTML = `
      <div class="settings-wrap as-wrap">

        <nav class="settings-tabs as-sidebar">
          <div class="settings-tab ${activeTab==='subscription'?'active':''}" data-tab="subscription">${t('settings_subscription')}</div>
          <div class="settings-tab ${activeTab==='display'?'active':''}" data-tab="display">${t('settings_display')}</div>
          <div class="settings-tab ${activeTab==='screensaver'?'active':''}" data-tab="screensaver">${t('settings_screensaver')}</div>
          <div class="settings-tab ${activeTab==='wallpaper'?'active':''}" data-tab="wallpaper">${t('settings_wallpaper')}</div>
          <div class="settings-tab ${activeTab==='regional'?'active':''}" data-tab="regional">${t('settings_regional')}</div>
          <div class="settings-tab ${activeTab==='filemanager'?'active':''}" data-tab="filemanager">${t('settings_filemanager')}</div>
          <div class="settings-tab ${activeTab==='users'?'active':''}" data-tab="users">${t('settings_users')}</div>
          <div class="settings-tab ${activeTab==='updates'?'active':''}" data-tab="updates">${t('settings_updates')}</div>
          <div class="settings-tab ${activeTab==='startmenu'?'active':''}" data-tab="startmenu">${t('settings_startmenu')}</div>
          <div class="settings-tab ${activeTab==='system'?'active':''}" data-tab="system">${t('settings_system')}</div>
          <div class="settings-tab ${activeTab==='sshaccess'?'active':''}" data-tab="sshaccess">🔐 ${t('settings_ssh_access')}</div>
          <div class="settings-tab ${activeTab==='backup'?'active':''}" data-tab="backup">${t('settings_backup')}</div>
          <div class="settings-tab ${activeTab==='about'?'active':''}" data-tab="about" style="margin-top:auto">${t('settings_about')}</div>
        </nav>

        <div class="settings-panels as-main">

          <!-- Subscription panel -->
          <div class="settings-panel ${activeTab==='subscription'?'active':''}" id="sp-subscription">
            <div class="settings-section">
              <div class="settings-section-title">💎 ${t('subscription_title')}</div>
              <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px 16px">
                <div style="display:flex;align-items:center;gap:8px;font-weight:600">
                  <span style="color:${isPremium ? 'var(--accent)' : 'var(--text-dim)'}">${isPremium ? '\u25c6' : '\u25cb'}</span>
                  <span>${isPremium ? t('subscription_premium') : t('subscription_free')}</span>
                </div>
                <div style="font-size:.82rem;color:var(--text-dim);margin-top:6px;line-height:1.45">
                  ${isPremium ? t('subscription_active_until', {date: expiry}) : t('subscription_free_desc')}
                </div>
              </div>
              ${premium.reason === 'duplicate' ? `<div style="font-size:.82rem;color:#e0a355;line-height:1.5;margin-top:12px">${t('subscription_duplicate')}</div>` : ''}
              <div style="font-size:.8rem;color:var(--text-dim);line-height:1.5;margin-top:12px">${t('subscription_keeps_working')}</div>
              ${isPremium ? '' : `<a class="s-btn" href="${site}" target="_blank" rel="noopener" style="display:inline-block;margin-top:12px;text-decoration:none">${t('subscription_buy')}</a>`}
            </div>

            <div class="settings-section">
              <div class="settings-section-title">${t('subscription_key_title')}</div>
              ${premium.license_key_set ? `
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                  <div style="flex:1;min-width:140px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-family:var(--mono,monospace);font-size:.85rem">${hint}</div>
                  <button class="s-btn" id="prem-recheck">${t('subscription_recheck')}</button>
                  <button class="s-btn" id="prem-remove">${t('subscription_remove')}</button>
                </div>
              ` : `
                <div style="font-size:.82rem;color:var(--text-dim);line-height:1.45;margin-bottom:12px">${t('subscription_key_desc')}</div>
                <label style="display:flex;flex-direction:column;gap:6px">
                  <span style="font-size:.82rem">${t('subscription_key')}</span>
                  <input class="s-input" id="prem-key" type="text" autocomplete="off" spellcheck="false" placeholder="${t('subscription_key_ph')}">
                </label>
                <div style="margin-top:12px"><button class="s-btn" id="prem-save">${t('subscription_save')}</button></div>
              `}
              <div id="prem-status" style="font-size:.8rem;color:var(--text-dim);margin-top:10px"></div>
            </div>

            ${premium.license_key_set ? `
            <div class="settings-section">
              <div class="settings-section-title">${t('subscription_devices_title')}</div>
              <div style="font-size:.82rem;color:var(--text-dim);line-height:1.45;margin-bottom:12px">${t('subscription_devices_desc')}</div>
              <div id="prem-devices"><div style="font-size:.82rem;color:var(--text-dim)">${t('subscription_checking')}</div></div>
            </div>
            ` : ''}
          </div>

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
                <div style="color:var(--text-dim);font-size:.83rem">${t('tstore_loading')}</div>
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
              <div class="settings-row">
                <label>${t('display_mobile_fullscreen')}</label>
                <input type="checkbox" id="s-mobile-fullscreen" ${(s.mobile_fullscreen !== false) ? 'checked' : ''}>
              </div>
            </div>
            <div class="settings-section" style="border-top:1px solid var(--border);padding-top:16px">
              <div class="settings-section-title">${t('display_gestures')}</div>
              ${[
                ['double_tap',         t('gesture_double_tap')],
                ['triple_tap',         t('gesture_triple_tap')],
                ['2finger_tap',        t('gesture_2finger_tap')],
                ['3finger_tap',        t('gesture_3finger_tap')],
                ['2finger_swipe_down', t('gesture_2finger_swipe_down')],
                ['2finger_swipe_up',   t('gesture_2finger_swipe_up')],
              ].map(([key, label]) => `
                <div class="settings-row">
                  <label>${label}</label>
                  <select id="s-gesture-${key}" class="s-select" style="width:160px">
                    <option value="" ${!(s['gesture_'+key]) ? 'selected' : ''}>${t('gesture_action_none')}</option>
                    <option value="close"         ${s['gesture_'+key]==='close'         ? 'selected' : ''}>${t('gesture_action_close')}</option>
                    <option value="minimize"      ${s['gesture_'+key]==='minimize'      ? 'selected' : ''}>${t('gesture_action_minimize')}</option>
                    <option value="switch"        ${s['gesture_'+key]==='switch'        ? 'selected' : ''}>${t('gesture_action_switch')}</option>
                    <option value="start"         ${s['gesture_'+key]==='start'         ? 'selected' : ''}>${t('gesture_action_start')}</option>
                    <option value="sidebar"       ${s['gesture_'+key]==='sidebar'       ? 'selected' : ''}>${t('gesture_action_sidebar')}</option>
                    <option value="notifications" ${s['gesture_'+key]==='notifications' ? 'selected' : ''}>${t('gesture_action_notifications')}</option>
                  </select>
                </div>
              `).join('')}
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

              <div class="settings-row">
                <label>${t('regional_currency')}</label>
                <select id="s-currency">
                  ${CURRENCIES.map(c =>
                    `<option value="${c.value}" ${(s.currency || 'EUR') === c.value ? 'selected' : ''}>${c.label}</option>`
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

          <!-- System panel -->
          <div class="settings-panel ${activeTab==='system'?'active':''}" id="sp-system">
            <div class="settings-section">
              <div class="settings-section-title">${t('system_error_reporting')}</div>
              <div class="settings-row">
                <div>
                  <div style="font-weight:500">${t('system_send_error_reports')}</div>
                  <div style="font-size:.8rem;color:var(--text-dim);margin-top:2px">${t('system_error_reports_desc')}</div>
                </div>
                <label class="toggle"><input type="checkbox" id="s-error-reporting"><span class="toggle-slider"></span></label>
              </div>
            </div>
          </div>

          <!-- Backup panel -->
          <div class="settings-panel ${activeTab==='backup'?'active':''}" id="sp-backup"></div>

          <!-- SSH access panel -->
          <div class="settings-panel ${activeTab==='sshaccess'?'active':''}" id="sp-sshaccess"></div>

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

          <!-- Wallpaper panel -->
          <div class="settings-panel ${activeTab==='wallpaper'?'active':''}" id="sp-wallpaper">
            <div class="settings-section">
              <div class="settings-section-title">${t('wp_title')}</div>
              <div id="wp-accordion" style="display:flex;flex-direction:column;gap:6px"></div>
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
        if (tab.dataset.tab === 'wallpaper') initWallpaper(body);
        if (tab.dataset.tab === 'system') renderSystem(body);
        if (tab.dataset.tab === 'backup') renderBackup(body);
        if (tab.dataset.tab === 'sshaccess') renderSshAccess(body);
        if (tab.dataset.tab === 'subscription') renderPremiumDevices();
      });
    });

    if (activeTab === 'users') renderUsers(body);
    if (activeTab === 'updates') renderUpdates(body);
    if (activeTab === 'about') renderAbout(body);
    if (activeTab === 'display' || !activeTab) renderThemePicker(body);
    if (activeTab === 'startmenu') renderStartMenu(body);
    if (activeTab === 'screensaver') initScreenSaver(body);
    if (activeTab === 'wallpaper') initWallpaper(body);
    if (activeTab === 'system') renderSystem(body);
    if (activeTab === 'backup') renderBackup(body);

    // ── Subscription ────────────────────────────────────────────────────
    const premStatus = () => body.querySelector('#prem-status');
    const showPremState = state => {
      window.dispatchEvent(new CustomEvent('premium-changed', { detail: state }));
      render(body, s, 'subscription', state);
    };
    const premMsg = (msg, bad) => {
      const el = premStatus();
      if (!el) return;
      el.textContent = msg;
      el.style.color = bad ? '#e05555' : 'var(--text-dim)';
    };
    const premError = validation => {
      if (!validation) return t('subscription_save_failed');
      if (validation.reason === 'unreachable') return t('subscription_unreachable');
      if (validation.reason === 'expired') return t('subscription_expired');
      if (validation.reason === 'seats_full') return t('subscription_seats_full');
      if (validation.reason === 'duplicate') return t('subscription_duplicate');
      return t('subscription_invalid');
    };

    async function renderPremiumDevices() {
      const wrap = body.querySelector('#prem-devices');
      if (!wrap) return;
      const res = await fetch('/api/premium/devices').catch(() => null);
      if (!res?.ok) {
        wrap.innerHTML = `<div style="font-size:.82rem;color:var(--text-dim)">${t('subscription_unreachable')}</div>`;
        return;
      }
      const data = await res.json();
      const devices = data.devices || [];
      if (!devices.length) {
        wrap.innerHTML = `<div style="font-size:.82rem;color:var(--text-dim)">${t('subscription_devices_none')}</div>`;
        return;
      }
      wrap.innerHTML = devices.map(d => {
        const here = d.device_id === data.this_device;
        const name = d.name || t('subscription_device_unnamed');
        const flagged = d.duplicates > 0;
        return `
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:9px 12px;margin-bottom:8px">
            <div style="flex:1;min-width:150px">
              <div style="font-size:.88rem">${name}${here ? ` <span style="color:var(--accent);font-size:.76rem;white-space:nowrap">${t('subscription_device_this')}</span>` : ''}</div>
              <div style="font-size:.75rem;color:var(--text-dim);margin-top:2px">${t('subscription_device_last_seen', {date: formatDate(d.last_seen, s.date_format, s.timezone)})}</div>
              ${flagged ? `<div style="font-size:.75rem;color:#e0a355;margin-top:2px">${t('subscription_device_conflicts', {count: d.duplicates})}</div>` : ''}
            </div>
            ${here ? '' : `<button class="s-btn-sm prem-release" data-device="${d.device_id}">${t('subscription_device_release')}</button>`}
          </div>`;
      }).join('');
      wrap.querySelectorAll('.prem-release').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          await fetch('/api/premium/devices/release', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({device_id: btn.dataset.device}),
          }).catch(() => null);
          renderPremiumDevices();
        });
      });
    }
    if (activeTab === 'subscription') renderPremiumDevices();

    body.querySelector('#prem-save')?.addEventListener('click', async e => {
      const input = body.querySelector('#prem-key');
      const key = input.value.trim();
      if (!key) { premMsg(t('subscription_key_required'), true); return; }
      e.target.disabled = true;
      premMsg(t('subscription_checking'));
      const res = await fetch('/api/premium/license', {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({license_key: key}),
      }).catch(() => null);
      const data = res?.ok ? await res.json() : null;
      if (!data) { premMsg(t('subscription_save_failed'), true); e.target.disabled = false; return; }
      if (data.status === 'premium') {
        showPremState(data);
        premMsg(t('subscription_downloading'));
        return;
      }
      showPremState(data);
      premMsg(premError(data.validation), true);
    });

    body.querySelector('#prem-recheck')?.addEventListener('click', async e => {
      e.target.disabled = true;
      premMsg(t('subscription_checking'));
      const res = await fetch('/api/premium?refresh=true').catch(() => null);
      const data = res?.ok ? await res.json() : null;
      if (!data) { premMsg(t('subscription_unreachable'), true); e.target.disabled = false; return; }
      showPremState(data);
      if (data.status !== 'premium') premMsg(t('subscription_expired'), true);
    });

    body.querySelector('#prem-remove')?.addEventListener('click', async e => {
      e.target.disabled = true;
      const res = await fetch('/api/premium/license', {method: 'DELETE'}).catch(() => null);
      const data = res?.ok ? await res.json() : null;
      if (!data) { premMsg(t('subscription_remove_failed'), true); e.target.disabled = false; return; }
      showPremState(data);
    });

    if (activeTab === 'sshaccess') renderSshAccess(body);

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
    const mobileFullscreen = body.querySelector('#s-mobile-fullscreen');
    if (mobileFullscreen) {
      mobileFullscreen.addEventListener('change', () => {
        saveSettings({ mobile_fullscreen: mobileFullscreen.checked });
      });
    }
    ['double_tap','triple_tap','2finger_tap','3finger_tap','2finger_swipe_down','2finger_swipe_up'].forEach(key => {
      const sel = body.querySelector(`#s-gesture-${key}`);
      if (sel) sel.addEventListener('change', () => saveSettings({ ['gesture_'+key]: sel.value }));
    });

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
          currency:    body.querySelector('#s-currency').value,
        });
      }, 400);
    };
    body.querySelector('#s-timezone').addEventListener('change', saveRegional);
    body.querySelector('#s-date-format').addEventListener('change', saveRegional);
    body.querySelectorAll('input[name="time_format"]').forEach(el => el.addEventListener('change', saveRegional));
    body.querySelectorAll('input[name="week_starts"]').forEach(el => el.addEventListener('change', saveRegional));
    body.querySelector('#s-show-date').addEventListener('change', saveRegional);
    body.querySelector('#s-language').addEventListener('change', saveRegional);
    body.querySelector('#s-currency').addEventListener('change', saveRegional);

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

  function _bkSchedLabel(key) {
    const hour12 = (window._vosSettings?.time_format || '24') === '12';
    const time = new Date(2000, 0, 1, 3, 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12 });
    return t(key).replace('{time}', time);
  }

  async function renderBackup(body) {
    const panel = body.querySelector('#sp-backup');

    async function loadList() {
      const listEl = panel.querySelector('#bk-list');
      listEl.innerHTML = `<div style="color:var(--text-dim);font-size:.85rem">${t('loading')}</div>`;
      try {
        const res = await fetch('/api/backup/list');
        const backups = await res.json();
        if (!backups.length) {
          listEl.innerHTML = `<div style="color:var(--text-dim);font-size:.85rem">${t('backup_none')}</div>`;
          return;
        }
        listEl.innerHTML = backups.map(b => {
          const date = new Date(b.created_at * 1000).toLocaleString();
          const mb = (b.size / 1024 / 1024).toFixed(1);
          return `
            <div style="background:var(--surface2);border-radius:8px;padding:10px 12px;margin-bottom:8px" data-file="${b.filename}">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <div style="flex:1;min-width:0">
                  <div style="font-family:monospace;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${b.filename}</div>
                  <div style="font-size:.75rem;color:var(--text-dim);margin-top:3px">${date} &middot; ${mb} MB</div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0">
                  <a class="s-btn-sm" href="/api/backup/download/${b.filename}" download>${t('backup_download')}</a>
                  <button class="s-btn-sm s-btn-danger bk-del">${t('users_delete')}</button>
                </div>
              </div>
            </div>`;
        }).join('');
        listEl.querySelectorAll('.bk-del').forEach(btn => {
          btn.addEventListener('click', async () => {
            const filename = btn.closest('[data-file]').dataset.file;
            if (!confirm(t('backup_delete_confirm').replace('{f}', filename))) return;
            await fetch(`/api/backup/${filename}`, { method: 'DELETE' });
            await loadList();
          });
        });
      } catch (_) {
        listEl.innerHTML = `<div style="color:#e05555;font-size:.85rem">${t('backup_load_failed')}</div>`;
      }
    }

    if (!panel.dataset.loaded) {
      panel.dataset.loaded = '1';
      panel.innerHTML = `
        <div class="settings-section">
          <div class="settings-section-title">${t('backup_title')}</div>
          <div style="font-size:.82rem;color:var(--text-dim);margin-bottom:12px">${t('backup_location')} <code>/var/backups/mvmos/</code></div>
          <div>
            <button class="s-btn" id="bk-create">${t('backup_create')}</button>
            <span id="bk-create-msg" style="font-size:.82rem;margin-left:10px"></span>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">${t('backup_auto_title')}</div>
          <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
            <div>
              <div style="font-size:.75rem;color:var(--text-dim);margin-bottom:4px">${t('backup_schedule')}</div>
              <select id="bk-schedule" class="s-input" style="width:auto">
                <option value="disabled">${t('backup_sched_disabled')}</option>
                <option value="daily">${_bkSchedLabel('backup_sched_daily')}</option>
                <option value="weekly">${_bkSchedLabel('backup_sched_weekly')}</option>
                <option value="monthly">${_bkSchedLabel('backup_sched_monthly')}</option>
              </select>
            </div>
            <div>
              <div style="font-size:.75rem;color:var(--text-dim);margin-bottom:4px">${t('backup_keep')}</div>
              <input id="bk-keep" type="number" class="s-input" min="1" max="99" value="5" style="width:70px">
            </div>
            <button class="s-btn" id="bk-sched-save">${t('save')}</button>
            <span id="bk-sched-msg" style="font-size:.82rem"></span>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">${t('backup_list_title')}</div>
          <div style="font-size:.82rem;color:var(--text-dim);margin-bottom:12px;padding:10px 12px;background:var(--surface2);border-radius:8px;line-height:1.6">
            ${t('backup_restore_info')} <code>bash restore.sh</code>
          </div>
          <div id="bk-list"></div>
        </div>`;

      panel.querySelector('#bk-create').addEventListener('click', async () => {
        const btn = panel.querySelector('#bk-create');
        const msg = panel.querySelector('#bk-create-msg');
        btn.disabled = true;
        msg.style.color = 'var(--text-dim)';
        msg.textContent = t('backup_creating');
        try {
          const res = await fetch('/api/backup/create', { method: 'POST' });
          const d = await res.json();
          if (res.ok) {
            msg.style.color = '#50fa7b';
            msg.textContent = t('backup_created');
            await loadList();
          } else {
            msg.style.color = '#e05555';
            msg.textContent = d.detail || t('backup_failed');
          }
        } catch (_) {
          msg.style.color = '#e05555';
          msg.textContent = t('backup_failed');
        }
        btn.disabled = false;
      });

      panel.querySelector('#bk-sched-save').addEventListener('click', async () => {
        const schedule = panel.querySelector('#bk-schedule').value;
        const keep = parseInt(panel.querySelector('#bk-keep').value) || 5;
        const msg = panel.querySelector('#bk-sched-msg');
        msg.style.color = 'var(--text-dim)';
        msg.textContent = '…';
        const res = await fetch('/api/backup/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schedule, keep }),
        });
        if (res.ok) {
          msg.style.color = '#50fa7b';
          msg.textContent = t('saved');
        } else {
          msg.style.color = '#e05555';
          msg.textContent = t('error');
        }
        setTimeout(() => { msg.textContent = ''; }, 2500);
      });

      fetch('/api/backup/schedule').then(r => r.json()).then(d => {
        panel.querySelector('#bk-schedule').value = d.schedule || 'disabled';
        panel.querySelector('#bk-keep').value = d.keep || 5;
      });
    }

    await loadList();
  }

  function openTotpSetup(username, secret, otpauthUrl, onSuccess) {
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(otpauthUrl)}`;
    const secretFmt = secret.match(/.{1,4}/g).join(' ');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--win-bg,#1e1e2e);border:1px solid var(--border,#45475a);border-radius:12px;padding:24px;width:400px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 16px 48px rgba(0,0,0,.6)">
        <div style="font-size:1rem;font-weight:700;margin-bottom:16px">${t('users_2fa_setup_title')}</div>

        <div style="font-size:.82rem;color:var(--text-dim);margin-bottom:8px">${t('users_2fa_scan')}</div>
        <div style="text-align:center;margin-bottom:14px">
          <img src="${qrSrc}" width="160" height="160"
               style="border-radius:8px;background:#fff;padding:6px;display:block;margin:0 auto"
               onerror="this.style.display='none'">
        </div>

        <div style="font-size:.82rem;color:var(--text-dim);margin-bottom:4px">${t('users_2fa_secret_label')}</div>
        <div style="display:flex;align-items:stretch;gap:6px;margin-bottom:12px">
          <div style="font-family:monospace;font-size:.95rem;letter-spacing:.08em;background:var(--surface2,#313244);border:1px solid var(--border,#45475a);border-radius:6px;padding:10px 12px;flex:1;user-select:all;word-break:break-all;cursor:text">${secretFmt}</div>
          <button id="totp-copy-secret" class="s-btn-sm" style="flex-shrink:0;white-space:nowrap">${t('settings_copy')}</button>
        </div>

        <div style="background:rgba(255,184,108,.08);border:1px solid rgba(255,184,108,.3);border-radius:6px;padding:10px 12px;font-size:.82rem;margin-bottom:16px;color:#ffb86c;line-height:1.5">
          &#9888; ${t('users_2fa_backup_warning')}
        </div>

        <div style="font-size:.82rem;color:var(--text-dim);margin-bottom:6px">${t('users_2fa_verify_label')}</div>
        <input id="totp-setup-code" type="text" inputmode="numeric" maxlength="6" placeholder="000000"
               class="s-input" style="text-align:center;font-size:1.3rem;letter-spacing:.2em;font-family:monospace;margin-bottom:6px">
        <div id="totp-setup-err" style="color:#e05555;font-size:.82rem;min-height:18px;margin-bottom:12px"></div>
        <div style="display:flex;gap:8px">
          <button id="totp-setup-cancel" class="s-btn" style="flex:1;background:var(--surface2,#45475a);color:var(--text)">${t('cancel')}</button>
          <button id="totp-setup-confirm" class="s-btn" style="flex:1">${t('users_2fa_enable_btn')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const codeInput = overlay.querySelector('#totp-setup-code');
    const errEl = overlay.querySelector('#totp-setup-err');
    setTimeout(() => codeInput.focus(), 60);

    const copyBtn = overlay.querySelector('#totp-copy-secret');
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(secret).catch(() => {});
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓ Copied';
      copyBtn.style.color = '#50fa7b';
      setTimeout(() => { copyBtn.textContent = orig; copyBtn.style.color = ''; }, 1800);
    });

    overlay.querySelector('#totp-setup-cancel').onclick = () => overlay.remove();

    const confirmBtn = overlay.querySelector('#totp-setup-confirm');
    confirmBtn.onclick = async () => {
      const code = codeInput.value.trim().replace(/\s/g, '');
      if (code.length !== 6) { errEl.textContent = t('users_2fa_code_required'); return; }
      errEl.textContent = '';
      confirmBtn.disabled = true;
      const res = await fetch(`/api/auth/totp/${username}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, code }),
      });
      if (res.ok) {
        overlay.remove();
        onSuccess();
      } else {
        const e = await res.json().catch(() => ({}));
        errEl.textContent = e.detail || t('users_2fa_code_invalid');
        confirmBtn.disabled = false;
        codeInput.value = '';
        codeInput.focus();
      }
    };
    codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') confirmBtn.click(); });
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
            <label>${t('users_2fa')}</label>
            <div style="display:flex;align-items:center;gap:10px">
              <label class="toggle"><input type="checkbox" class="user-totp-chk"><span class="toggle-slider"></span></label>
              <span class="user-totp-label" style="font-size:.82rem;color:#50fa7b"></span>
            </div>
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

      row.querySelector('.user-edit-btn').addEventListener('click', async () => {
        const panel = row.querySelector('.user-edit-panel');
        const opening = panel.style.display === 'none';
        panel.style.display = opening ? 'block' : 'none';
        if (opening) {
          try {
            const res = await fetch(`/api/auth/totp/${u.username}`);
            const data = await res.json();
            const chk = row.querySelector('.user-totp-chk');
            chk.checked = data.enabled;
            row.querySelector('.user-totp-label').textContent = data.enabled ? t('users_2fa_on') : '';
          } catch (_) {}
        }
      });

      row.querySelector('.user-totp-chk').addEventListener('change', async function() {
        const chk = this;
        const label = row.querySelector('.user-totp-label');
        if (chk.checked) {
          chk.checked = false;
          const res = await fetch(`/api/auth/totp/${u.username}/setup`, { method: 'POST' });
          if (!res.ok) return;
          const setup = await res.json();
          openTotpSetup(u.username, setup.secret, setup.otpauth_url, () => {
            chk.checked = true;
            label.textContent = t('users_2fa_on');
          });
        } else {
          if (!confirm(t('users_2fa_disable_confirm'))) { chk.checked = true; return; }
          await fetch(`/api/auth/totp/${u.username}`, { method: 'DELETE' });
          label.textContent = '';
        }
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
            outputEl.style.color = '';
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
      const ok = await mvmOS.requireRoot(t('about_system_update'), t('about_new_version', { local: '', remote: '' }).trim());
      if (!ok) return;
      updateBtn.disabled = true;
      outputEl.style.display = 'block';
      outputEl.textContent = '';
      statusEl.textContent = t('about_updating');

      const res = await fetch('/api/system/update', { method: 'POST' });
      if (!res.ok) {
        // 403 = non-root session; surface it instead of hanging on an empty stream
        statusEl.style.color = '#f38ba8';
        statusEl.textContent = res.status === 403 ? t('about_update_no_perm') : t('about_update_failed');
        updateBtn.disabled = false;
        return;
      }
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
    // Disable error reporting — fetch errors during restart are expected
    window.dispatchEvent(new CustomEvent('error-reporting-changed', { detail: false }));
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
      wrap.innerHTML = `<div style="color:#e05555;font-size:.83rem">${t('tstore_failed')}</div>`;
      return;
    }

    if (!themes.length) {
      wrap.innerHTML = `<div style="color:var(--text-dim);font-size:.83rem">${t('tstore_no_installed_hint')}</div>`;
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

  // ── Start Menu settings (stored server-side via /api/settings) ─────────────

  async function loadStartMenuPrefs() {
    if (!Object.keys(currentSettings).length) await loadSettings();
    return currentSettings.start_menu || null;
  }

  async function saveStartMenuPrefs(prefs) {
    currentSettings.start_menu = prefs;
    await saveSettings(currentSettings);
    _applyStartMenuOpacity(prefs.opacity ?? 80);
    window.dispatchEvent(new CustomEvent('startmenu-changed', { detail: prefs }));
  }

  function defaultStartMenuPrefs() {
    return {
      order: ['recent', 'frequent', 'custom'],
      recent: 0,
      frequent: 0,
      custom: [],
      opacity: 80,
    };
  }

  function _applyStartMenuOpacity(opacity) {
    const bar = document.getElementById('taskbar');
    if (!bar) return;
    bar.style.opacity = '';
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;background:var(--taskbar)';
    document.body.appendChild(tmp);
    const bg = getComputedStyle(tmp).backgroundColor;
    document.body.removeChild(tmp);
    const m = bg.match(/\d+/g);
    if (m && m.length >= 3) {
      const rgba = `rgba(${m[0]},${m[1]},${m[2]},${Number(opacity)/100})`;
      bar.style.background = rgba;
      const fsBar = document.getElementById('fs-taskbar');
      if (fsBar) fsBar.style.background = rgba;
    }
  }

  async function renderStartMenu(body) {
    const panel = body.querySelector('#sp-startmenu');
    if (!panel) return;
    const prefs = (await loadStartMenuPrefs()) || defaultStartMenuPrefs();
    const allApps = Object.values(window.mvmOS?._apps || {}).sort((a, b) => a.name.localeCompare(b.name));

    function _saveAndRedraw() { saveStartMenuPrefs(prefs); _draw(); }

    function _blockLabel(id) {
      return id === 'recent' ? t('sm_recent') : id === 'frequent' ? t('sm_frequent') : t('sm_custom');
    }

    function _draw() {
      const opacity = prefs.opacity ?? 80;
      panel.innerHTML = `<div style="padding:4px 0">
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px 14px;margin-bottom:10px">
          <div style="font-weight:600;font-size:.84rem;margin-bottom:10px">${t('sm_opacity') || 'Background opacity'}</div>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="range" id="sm-opacity-slider" min="10" max="100" step="5" value="${opacity}" style="flex:1">
            <span id="sm-opacity-val" style="font-size:.82rem;color:var(--text-dim);min-width:36px;text-align:right">${opacity}%</span>
          </div>
        </div>
      ` + prefs.order.map((blockId, idx) => {
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
      const slider = panel.querySelector('#sm-opacity-slider');
      const valEl  = panel.querySelector('#sm-opacity-val');
      if (slider) {
        slider.addEventListener('input', () => {
          valEl.textContent = slider.value + '%';
          _applyStartMenuOpacity(slider.value);
        });
        slider.addEventListener('change', () => {
          prefs.opacity = parseInt(slider.value);
          saveStartMenuPrefs(prefs);
        });
      }
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
      { id: 'widget', label: t('ss_type_widget'),  icon: '🔲' },
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
        <div class="ss-acc-body" style="display:${(tp.id === 'photos' || tp.id === 'widget') && isActive ? 'block' : 'none'};padding:10px 14px;border-top:1px solid var(--border);background:var(--bg)"></div>
      `;

      const header = item.querySelector('.ss-acc-header');
      const bodyEl = item.querySelector('.ss-acc-body');
      const selectBtn = item.querySelector('.ss-select-btn');

      if (tp.id === 'photos') {
        _buildPhotosSettings(bodyEl);
      } else if (tp.id === 'widget') {
        _buildWidgetSettings(bodyEl);
      }

      if (selectBtn) {
        selectBtn.addEventListener('click', e => {
          e.stopPropagation();
          localStorage.setItem('ss_type', tp.id);
          initScreenSaver(body); // re-render
        });
      }

      if ((tp.id === 'photos' || tp.id === 'widget') && isActive) {
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
          <input id="ss-photos-folder" type="text" class="s-input" style="width:130px;font-size:.82rem" placeholder="Pictures" value="${folder}" readonly>
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
    container.querySelector('#ss-folder-browse').addEventListener('click', async () => {
      const input = container.querySelector('#ss-photos-folder');
      const r = await fetch('/api/auth/whoami');
      const me = await r.json();
      const home = me.effective_user === 'root' ? '/root' : `/home/${me.effective_user}`;
      FolderPicker.open({
        root: home,
        asRoot: me.effective_user === 'root',
        onSelect: path => {
          // store relative to home
          const rel = path.startsWith(home + '/') ? path.slice(home.length + 1) : path;
          input.value = rel;
          localStorage.setItem('ss_photos_folder', rel);
        }
      });
    });
    container.querySelector('#ss-photos-period').addEventListener('change', e => {
      localStorage.setItem('ss_photos_period', e.target.value);
    });
  }

  function _buildWidgetSettings(container) {
    const savedId = localStorage.getItem('ss_widget_id') || '';
    const widgets = Object.values(window.mvmOS?._widgets || {});

    if (!widgets.length) {
      container.innerHTML = `<div style="font-size:.85rem;color:var(--text-dim)">${t('ss_widget_none')}</div>`;
      return;
    }

    container.innerHTML = `
      <div class="settings-row">
        <span style="font-size:.85rem">${t('ss_widget_choose')}</span>
        <select id="ss-widget-select" class="s-input" style="width:160px;font-size:.82rem">
          ${widgets.map(w => `<option value="${w.id}" ${w.id === savedId ? 'selected' : ''}>${w.icon || '🔲'} ${w.name || w.id}</option>`).join('')}
        </select>
      </div>
    `;
    if (!savedId && widgets.length) localStorage.setItem('ss_widget_id', widgets[0].id);

    container.querySelector('#ss-widget-select').addEventListener('change', e => {
      localStorage.setItem('ss_widget_id', e.target.value);
    });
  }

  async function _saveWp(partial) {
    if (!Object.keys(currentSettings).length) await loadSettings();
    await saveSettings({ ...currentSettings, ...partial });
  }

  async function initWallpaper(body) {
    const accordion = body.querySelector('#wp-accordion');
    if (!accordion) return;
    if (!Object.keys(currentSettings).length) await loadSettings();
    accordion.innerHTML = '';
    const activeType = currentSettings.wp_type || 'logo';
    const types = [
      { id: 'logo',   label: t('wp_type_logo'),   icon: '🖥' },
      { id: 'static', label: t('wp_type_static'),  icon: '🖼' },
      { id: 'folder', label: t('wp_type_folder'),  icon: '🎞' },
    ];
    types.forEach(tp => {
      const isActive = activeType === tp.id;
      const item = document.createElement('div');
      item.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius);overflow:hidden';
      item.innerHTML = `
        <div class="wp-acc-header" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;background:${isActive ? 'var(--accent-dim, rgba(99,102,241,.12))' : 'var(--surface)'}">
          <span style="font-size:1.1rem">${tp.icon}</span>
          <span style="flex:1;font-size:.9rem;font-weight:500">${tp.label}</span>
          ${isActive ? `<span style="font-size:.75rem;color:var(--accent);font-weight:600">${t('ss_active')}</span>` : `<button class="s-btn s-btn-sm wp-select-btn">${t('ss_select')}</button>`}
        </div>
        <div class="wp-acc-body" style="display:${(tp.id === 'static' || tp.id === 'folder') && isActive ? 'block' : 'none'};padding:10px 14px;border-top:1px solid var(--border);background:var(--bg)"></div>
      `;
      const header = item.querySelector('.wp-acc-header');
      const bodyEl = item.querySelector('.wp-acc-body');
      const selectBtn = item.querySelector('.wp-select-btn');
      if (tp.id === 'static') _buildWallpaperStaticSettings(bodyEl);
      else if (tp.id === 'folder') _buildWallpaperFolderSettings(bodyEl);
      if (selectBtn) {
        selectBtn.addEventListener('click', async e => {
          e.stopPropagation();
          await _saveWp({ wp_type: tp.id });
          window.dispatchEvent(new Event('wallpaper-changed'));
          initWallpaper(body);
        });
      }
      if ((tp.id === 'static' || tp.id === 'folder') && isActive) {
        header.addEventListener('click', () => {
          bodyEl.style.display = bodyEl.style.display === 'none' ? 'block' : 'none';
        });
      }
      accordion.appendChild(item);
    });
  }

  function _buildWallpaperStaticSettings(container) {
    const path = currentSettings.wp_static_path || '';
    const fname = path ? path.split('/').pop() : '';
    container.innerHTML = `
      <div class="settings-row">
        <span style="font-size:.85rem">${t('wp_static_file')}</span>
        <div style="display:flex;gap:6px;flex:1;justify-content:flex-end">
          <input id="wp-static-path" type="text" class="s-input" style="width:130px;font-size:.82rem" placeholder="image.jpg" value="${fname}" readonly>
          <button class="s-btn s-btn-sm" id="wp-static-browse">…</button>
        </div>
      </div>
    `;
    container.querySelector('#wp-static-browse').addEventListener('click', () => {
      _openImagePicker(async fullPath => {
        container.querySelector('#wp-static-path').value = fullPath.split('/').pop();
        await _saveWp({ wp_static_path: fullPath });
        window.dispatchEvent(new Event('wallpaper-changed'));
      });
    });
  }

  function _buildWallpaperFolderSettings(container) {
    const folder = currentSettings.wp_folder || '';
    const period = currentSettings.wp_period || '10';
    container.innerHTML = `
      <div class="settings-row" style="margin-bottom:8px">
        <span style="font-size:.85rem">${t('ss_photos_folder')}</span>
        <div style="display:flex;gap:6px;flex:1;justify-content:flex-end">
          <input id="wp-folder" type="text" class="s-input" style="width:130px;font-size:.82rem" placeholder="Pictures" value="${folder}" readonly>
          <button class="s-btn s-btn-sm" id="wp-folder-browse">…</button>
        </div>
      </div>
      <div class="settings-row">
        <span style="font-size:.85rem">${t('ss_photos_period')}</span>
        <select id="wp-period" class="s-input" style="width:100px;font-size:.82rem">
          <option value="1">1 ${t('ss_min')}</option>
          <option value="5">5 ${t('ss_min')}</option>
          <option value="10">10 ${t('ss_min')}</option>
          <option value="30">30 ${t('ss_min')}</option>
          <option value="60">60 ${t('ss_min')}</option>
        </select>
      </div>
    `;
    container.querySelector('#wp-period').value = period;
    container.querySelector('#wp-folder-browse').addEventListener('click', async () => {
      const me = await (await fetch('/api/auth/whoami')).json();
      const home = me.effective_user === 'root' ? '/root' : `/home/${me.effective_user}`;
      FolderPicker.open({
        root: home,
        asRoot: me.effective_user === 'root',
        onSelect: async path => {
          const rel = path.startsWith(home + '/') ? path.slice(home.length + 1) : path;
          container.querySelector('#wp-folder').value = rel;
          await _saveWp({ wp_folder: rel });
          window.dispatchEvent(new Event('wallpaper-changed'));
        }
      });
    });
    container.querySelector('#wp-period').addEventListener('change', async e => {
      await _saveWp({ wp_period: e.target.value });
      window.dispatchEvent(new Event('wallpaper-changed'));
    });
  }

  async function _openImagePicker(onSelect) {
    const me = await (await fetch('/api/auth/whoami')).json();
    const home = me.effective_user === 'root' ? '/root' : `/home/${me.effective_user}`;
    const asRoot = me.effective_user === 'root';
    const IMG_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','svg']);

    document.getElementById('wp-img-picker')?.remove();
    let currentPath = home;

    const ov = document.createElement('div');
    ov.id = 'wp-img-picker';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center';
    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);width:min(460px,92vw);max-height:75vh;display:flex;flex-direction:column;box-shadow:var(--shadow)';

    async function _render() {
      let entries = [];
      try {
        const d = await (await fetch(`/api/files?path=${encodeURIComponent(currentPath)}${asRoot ? '&as_root=true' : ''}`)).json();
        entries = (d.entries || []).filter(e => !e.name.startsWith('.'));
      } catch {}
      const folders = entries.filter(e => e.is_dir || e.type === 'dir').sort((a,b) => a.name.localeCompare(b.name));
      const images  = entries.filter(e => !(e.is_dir || e.type === 'dir') && IMG_EXT.has(e.name.split('.').pop().toLowerCase())).sort((a,b) => a.name.localeCompare(b.name));

      const homeParts = home.replace(/\/+$/, '').split('/').filter(Boolean);
      const curParts  = currentPath.replace(/\/+$/, '').split('/').filter(Boolean);
      const crumbs = [{ label: '~', path: home }];
      let acc = home;
      for (let i = homeParts.length; i < curParts.length; i++) {
        acc += '/' + curParts[i];
        crumbs.push({ label: curParts[i], path: acc });
      }

      modal.innerHTML = `
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
          <span style="flex:1;font-weight:600;font-size:.95rem">${t('wp_static_file')}</span>
          <button id="wip-close" style="background:none;border:none;cursor:pointer;font-size:1.1rem;color:var(--text-dim)">✕</button>
        </div>
        <div id="wip-bc" style="padding:8px 16px;display:flex;align-items:center;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--border);font-size:.82rem"></div>
        <div id="wip-list" style="overflow-y:auto;flex:1;padding:6px 0;min-height:80px"></div>
        <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
          <button class="s-btn" id="wip-cancel">${t('cancel') || 'Cancel'}</button>
        </div>
      `;

      const bc = modal.querySelector('#wip-bc');
      crumbs.forEach((c, i) => {
        const span = document.createElement('span');
        if (i < crumbs.length - 1) {
          span.innerHTML = `<a href="#" style="color:var(--accent);text-decoration:none">${c.label}</a><span style="color:var(--text-dim);margin:0 2px">/</span>`;
          span.querySelector('a').addEventListener('click', e => { e.preventDefault(); currentPath = c.path; _render(); });
        } else {
          span.textContent = c.label;
          span.style.fontWeight = '500';
        }
        bc.appendChild(span);
      });

      const list = modal.querySelector('#wip-list');
      if (!folders.length && !images.length) {
        list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:.85rem">${t('fp_empty') || 'Empty'}</div>`;
      }
      folders.forEach(f => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 16px;cursor:pointer;font-size:.88rem';
        row.innerHTML = `<span>📁</span><span style="flex:1">${f.name}</span>`;
        row.addEventListener('mouseenter', () => row.style.background = 'var(--hover)');
        row.addEventListener('mouseleave', () => row.style.background = '');
        row.addEventListener('click', () => { currentPath = currentPath.replace(/\/+$/, '') + '/' + f.name; _render(); });
        list.appendChild(row);
      });
      images.forEach(img => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 16px;cursor:pointer;font-size:.88rem';
        row.innerHTML = `<span>🖼</span><span style="flex:1">${img.name}</span>`;
        row.addEventListener('mouseenter', () => row.style.background = 'var(--hover)');
        row.addEventListener('mouseleave', () => row.style.background = '');
        row.addEventListener('click', () => {
          ov.remove();
          onSelect(currentPath.replace(/\/+$/, '') + '/' + img.name);
        });
        list.appendChild(row);
      });
      modal.querySelector('#wip-close').addEventListener('click', () => ov.remove());
      modal.querySelector('#wip-cancel').addEventListener('click', () => ov.remove());
    }

    ov.appendChild(modal);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    _render();
  }

  async function renderSshAccess(body) {
    const panel = body.querySelector('#sp-sshaccess');
    if (!panel) return;
    const esc = value => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    panel.innerHTML = `<div style="color:var(--text-dim);font-size:.85rem">${t('loading')}</div>`;
    let status, keys;
    try {
      status = await fetch('/api/ssh-access/status').then(r => r.json());
      if (!status.requires_root) keys = await fetch('/api/ssh-access/keys').then(r => r.json());
    } catch (_) {
      panel.innerHTML = `<div style="color:#e05555">${t('ssh_access_load_error')}</div>`;
      return;
    }
    if (!status.supported) {
      panel.innerHTML = `<div class="settings-section"><div class="settings-section-title">${t('ssh_access_title')}</div><div style="color:#e05555">${t('ssh_access_unsupported')}</div></div>`;
      return;
    }
    const rows = Array.isArray(keys) ? keys.map(key => `
      <div class="settings-row" style="align-items:flex-start;gap:12px">
        <div style="flex:1;min-width:0"><div style="font-weight:600">${esc(key.label)} ${key.active_now ? `<span style="color:#55b971;font-size:.75rem">${t('ssh_access_active')}</span>` : `<span style="color:var(--text-dim);font-size:.75rem">${t('ssh_access_inactive')}</span>`}</div><div style="font:0.72rem monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-dim);margin-top:3px">${esc(key.public_key)}</div><div style="font-size:.76rem;color:var(--text-dim);margin-top:4px">${t('ssh_access_schedule')}: ${esc(key.start_time)}–${esc(key.end_time)}</div></div>
        <div style="display:flex;gap:6px"><button class="s-btn-sm ssh-settings" data-id="${key.id}">${t('ssh_access_settings')}</button><button class="s-btn-sm s-btn-danger ssh-delete" data-id="${key.id}">${t('ssh_access_remove')}</button></div>
      </div>`).join('') : '';
    panel.innerHTML = `
      <div class="settings-section"><div class="settings-section-title">${t('ssh_access_title')}</div><div style="font-size:.82rem;color:var(--text-dim);line-height:1.45">${t('ssh_access_desc')}</div>
      ${status.enabled ? `<div style="margin-top:10px;color:#55b971;font-size:.82rem">${t('ssh_access_enabled')}</div>` : (status.can_admin ? `<button class="settings-btn" id="ssh-enable" style="margin-top:12px">${t('ssh_access_enable')}</button>` : `<div style="margin-top:10px;color:var(--text-dim);font-size:.82rem">${t('ssh_access_root_required')}</div>`)}</div>
      <div class="settings-section" ${status.enabled ? '' : 'style="opacity:.55;pointer-events:none"'}><div class="settings-section-title">${t('ssh_access_keys')}</div><div id="ssh-keys">${rows || `<div style="color:var(--text-dim);font-size:.83rem">${t('ssh_access_empty')}</div>`}</div><button class="s-btn s-btn-primary" id="ssh-add" style="margin-top:12px">${t('ssh_access_add')}</button></div>`;
    const password = () => window.mvmOS.confirmPassword(t('ssh_access_title'), t('ssh_access_password_prompt'));
    const request = async (url, options) => {
      const res = await fetch(url, options);
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.detail || t('ssh_access_action_error')); }
      return res.json();
    };
    panel.querySelector('#ssh-enable')?.addEventListener('click', async () => {
      const pass = await password(); if (pass === null) return;
      try { await request('/api/ssh-access/enable', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass})}); renderSshAccess(body); } catch (e) { alert(e.message); }
    });
    panel.querySelector('#ssh-add')?.addEventListener('click', async () => {
      const label = prompt(t('ssh_access_label_prompt')); if (!label) return;
      const public_key = prompt(t('ssh_access_key_prompt')); if (!public_key) return;
      const pass = await password(); if (pass === null) return;
      try { await request('/api/ssh-access/keys', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label,public_key,password:pass})}); renderSshAccess(body); } catch (e) { alert(e.message); }
    });
    panel.querySelectorAll('.ssh-settings').forEach(button => button.addEventListener('click', async () => {
      const key = keys.find(item => item.id === Number(button.dataset.id)); if (!key) return;
      const dayNames = [t('ssh_access_mon'),t('ssh_access_tue'),t('ssh_access_wed'),t('ssh_access_thu'),t('ssh_access_fri'),t('ssh_access_sat'),t('ssh_access_sun')];
      const hour12 = currentSettings.time_format === '12';
      const formatTime = value => { if (value === '24:00') return hour12 ? '12:00 AM' : value; const [h,m]=value.split(':').map(Number); return hour12 ? `${((h+11)%12)+1}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}` : value; };
      const timeValues = Array.from({length:97}, (_,i) => i === 96 ? '24:00' : `${String(Math.floor(i/4)).padStart(2,'0')}:${String((i%4)*15).padStart(2,'0')}`);
      const timeOptions = selected => timeValues.map(value => `<option value="${value}" ${value===selected?'selected':''}>${formatTime(value)}</option>`).join('');
      const ov = document.createElement('div'); ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center';
      ov.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:20px;width:360px;max-width:92%"><div style="font-weight:700;margin-bottom:14px">${t('ssh_access_settings')}</div><label class="settings-row"><span>${t('ssh_access_enabled_label')}</span><input id="sak-enabled" type="checkbox" ${key.enabled?'checked':''}></label><div style="font-size:.82rem;margin:12px 0 6px">${t('ssh_access_days')}</div><div style="display:flex;flex-wrap:wrap;gap:8px">${dayNames.map((name,i)=>`<label style="font-size:.78rem"><input type="checkbox" class="sak-day" value="${i}" ${key.days.includes(i)?'checked':''}> ${name}</label>`).join('')}</div><div style="display:flex;gap:12px;margin-top:16px"><label style="flex:1;font-size:.8rem">${t('ssh_access_start')}<select id="sak-start" class="s-input">${timeOptions(key.start_time)}</select></label><label style="flex:1;font-size:.8rem">${t('ssh_access_end')}<select id="sak-end" class="s-input">${timeOptions(key.end_time)}</select></label></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button id="sak-cancel" class="s-btn-sm">${t('cancel')}</button><button id="sak-save" class="s-btn">${t('save')}</button></div></div>`;
      document.body.appendChild(ov); ov.querySelector('#sak-cancel').onclick=()=>ov.remove();
      ov.querySelector('#sak-save').onclick=async()=>{ const pass=await password(); if(pass===null)return; const days=[...ov.querySelectorAll('.sak-day:checked')].map(el=>Number(el.value)); const start_time=ov.querySelector('#sak-start').value, end_time=ov.querySelector('#sak-end').value; try { await request(`/api/ssh-access/keys/${key.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass,days,start_time,end_time,enabled:ov.querySelector('#sak-enabled').checked})}); ov.remove(); renderSshAccess(body); } catch(e){alert(e.message);} };
    }));
    panel.querySelectorAll('.ssh-delete').forEach(button => button.addEventListener('click', async () => {
      if (!confirm(t('ssh_access_remove_confirm'))) return;
      const pass = await password(); if (pass === null) return;
      try { await request(`/api/ssh-access/keys/${button.dataset.id}`, {method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass})}); renderSshAccess(body); } catch (e) { alert(e.message); }
    }));
  }

  function renderSystem(body) {
    const panel = body.querySelector('#sp-system');
    if (!panel) return;
    const cb = panel.querySelector('#s-error-reporting');
    if (!cb) return;
    cb.checked = currentSettings.error_reporting !== false;
    cb.addEventListener('change', () => {
      saveSettings({ error_reporting: cb.checked });
      window.dispatchEvent(new CustomEvent('error-reporting-changed', { detail: cb.checked }));
    });
  }

  return { openWindow, get, initDisplay, loadFMPrefs, loadStartMenuPrefs, defaultStartMenuPrefs, initScreenSaver, initWallpaper, applyStartMenuOpacity: _applyStartMenuOpacity };
})();
