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
  const DISPLAY_KEY = 'vos_display';

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

  function openWindow() {
    Desktop.createWindow({
      id: 'settings',
      title: '⚙️ Settings',
      width: 560,
      height: 520,
      onMount(body) {
        loadSettings().then(s => render(body, s));
      },
    });
  }

  function render(body, s) {
    const d = loadDisplay();
    body.style.overflow = 'auto';
    body.innerHTML = `
      <div class="settings-wrap">

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

        <div class="settings-actions">
          <button id="s-save">Save Changes</button>
          <span id="s-saved-msg" style="display:none;color:#50fa7b;font-size:.85rem;">✓ Saved</span>
        </div>

      </div>
    `;

    updateTimePreviews();
    setInterval(updateTimePreviews, 10000);

    // live preview for sliders
    const iconSlider = body.querySelector('#s-icon-size');
    const textSlider = body.querySelector('#s-text-size');
    const prevIcon   = body.querySelector('#prev-icon');
    const prevText   = body.querySelector('#prev-text');

    const ICON_FONT_PREVIEW = ['1.1rem','1.4rem','1.8rem','2.3rem','2.9rem'];
    const TEXT_PREVIEW      = ['11px','12.5px','14px','15.5px','17px'];

    iconSlider.addEventListener('input', () => {
      const i = parseInt(iconSlider.value) - 1;
      prevIcon.style.fontSize = ICON_FONT_PREVIEW[i];
    });
    textSlider.addEventListener('input', () => {
      const i = parseInt(textSlider.value) - 1;
      prevText.style.fontSize = TEXT_PREVIEW[i];
    });

    // init preview sizes
    prevIcon.style.fontSize = ICON_FONT_PREVIEW[parseInt(iconSlider.value) - 1];
    prevText.style.fontSize = TEXT_PREVIEW[parseInt(textSlider.value) - 1];

    body.querySelector('#s-save').addEventListener('click', () => {
      const data = {
        timezone:    body.querySelector('#s-timezone').value,
        time_format: body.querySelector('input[name="time_format"]:checked').value,
        date_format: body.querySelector('#s-date-format').value,
        week_starts: body.querySelector('input[name="week_starts"]:checked').value,
        language:    body.querySelector('#s-language').value,
      };
      const display = {
        icon_size: body.querySelector('#s-icon-size').value,
        text_size: body.querySelector('#s-text-size').value,
      };
      saveDisplay(display);
      saveSettings(data).then(() => {
        const msg = body.querySelector('#s-saved-msg');
        msg.style.display = 'inline';
        setTimeout(() => msg.style.display = 'none', 2000);
      });
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

  return { openWindow, get, initDisplay };
})();
