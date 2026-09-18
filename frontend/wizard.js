// ── Setup Wizard — mvmOS ─────────────────────────────────────────────────────
// Shown once on a fresh installation and again whenever a release adds a step.
// The backend owns "which revision has been finished"; this file only renders
// the steps and reports back when every one of them has actually been looked at.

const Wizard = (() => {

  let _state = null;      // last payload from /api/wizard
  let _index = 0;         // step currently on screen
  let _seen = new Set();  // step ids visited during this run
  let _overlay = null;
  let _settings = {};

  // ── State ────────────────────────────────────────────────────────────────
  async function load() {
    try {
      const res = await fetch('/api/wizard');
      if (!res.ok) return null;
      _state = await res.json();
    } catch (_) { _state = null; }
    return _state;
  }

  function isPending() { return !!_state?.pending; }

  // Steps added since the last completed run. Empty on a fresh installation,
  // where singling anything out as "new" would be meaningless.
  function newStepIds() {
    return (_state?.steps || []).filter(s => s.is_new).map(s => s.id);
  }

  async function complete() {
    try {
      const res = await fetch('/api/wizard/complete', { method: 'POST' });
      if (res.ok) _state = await res.json();
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('wizard-changed', { detail: _state }));
  }

  async function reset() {
    try {
      const res = await fetch('/api/wizard/reset', { method: 'POST' });
      if (res.ok) _state = await res.json();
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('wizard-changed', { detail: _state }));
  }

  // Opens itself only on a genuinely fresh installation. A release that adds a
  // step raises the blue dot instead of taking over the screen of someone who
  // is in the middle of something.
  async function maybeAutoRun() {
    await load();
    if (_state?.first_run) open();
    else window.dispatchEvent(new CustomEvent('wizard-changed', { detail: _state }));
  }

  // ── Shell ────────────────────────────────────────────────────────────────
  async function open() {
    if (_overlay) return;
    await (window.mvmOS?.i18nReady || Promise.resolve());
    if (!_state) await load();
    if (!_state) return;
    _index = 0;
    _seen = new Set();
    try {
      _settings = await (await fetch('/api/settings')).json();
    } catch (_) { _settings = {}; }

    _overlay = document.createElement('div');
    _overlay.className = 'wiz-overlay';
    _overlay.innerHTML = `
      <div class="wiz" role="dialog" aria-modal="true">
        <div class="wiz-head">
          <div class="wiz-title" id="wiz-title"></div>
          <div class="wiz-dots" id="wiz-dots"></div>
        </div>
        <div class="wiz-body" id="wiz-body"></div>
        <div class="wiz-foot">
          <button class="s-btn" id="wiz-skip"></button>
          <div style="flex:1"></div>
          <button class="s-btn" id="wiz-back"></button>
          <button class="s-btn s-btn-primary" id="wiz-next"></button>
        </div>
      </div>`;
    document.body.appendChild(_overlay);

    _overlay.querySelector('#wiz-skip').onclick = () => close();
    _overlay.querySelector('#wiz-back').onclick = () => go(_index - 1);
    _overlay.querySelector('#wiz-next').onclick = async () => {
      if (_index < steps().length - 1) return go(_index + 1);
      // Last step: finishing is only offered once every step has been seen,
      // so the button cannot be reached in any other state.
      await complete();
      close();
    };

    // A language chosen on the first screen has to reach the wizard's own
    // chrome, not just the desktop behind it.
    window.mvmOS?.onLangChange?.(() => { if (_overlay) paint(); });

    go(0);
  }

  function close() {
    _overlay?.remove();
    _overlay = null;
  }

  function steps() { return _state?.steps || []; }

  function go(i) {
    const list = steps();
    if (i < 0 || i >= list.length) return;
    _index = i;
    _seen.add(list[i].id);
    paint();
  }

  function allSeen() {
    return steps().every(s => _seen.has(s.id));
  }

  // A button that opens something on the desktop has to get the wizard out of
  // the way first: the overlay covers every window, so the panel would open
  // correctly and still be invisible behind it. Both such buttons live on the
  // last steps, where every step has normally already been seen — in that case
  // the run counts as finished, so handing over does not cost the owner the
  // wizard's completion and it will not come back on the next login.
  async function handOver(action) {
    if (allSeen()) await complete();
    close();
    action();
  }

  function paint() {
    if (!_overlay) return;
    const list = steps();
    const step = list[_index];
    if (!step) return;
    const last = _index === list.length - 1;

    _overlay.querySelector('#wiz-title').textContent = t('wiz_step_' + step.id + '_title');
    _overlay.querySelector('#wiz-dots').innerHTML = list.map((s, i) =>
      `<span class="wiz-dot${i === _index ? ' active' : ''}${_seen.has(s.id) ? ' seen' : ''}" title="${t('wiz_step_' + s.id + '_title')}"></span>`
    ).join('');

    const back = _overlay.querySelector('#wiz-back');
    back.textContent = t('wiz_back');
    back.style.visibility = _index === 0 ? 'hidden' : '';

    const next = _overlay.querySelector('#wiz-next');
    // "Finish" appears on the last step, but stays disabled until every step
    // has been opened — that is what marks the wizard as read. The privacy
    // step holds it too, until the statistics question has an answer: a
    // default nobody chose is not an answer, so the wizard asks for one
    // instead of assuming.
    const undecided = step.id === 'privacy' && _settings.analytics === undefined;
    next.textContent = last ? t('wiz_finish') : t('wiz_next');
    next.disabled = undecided || (last && !allSeen());
    next.title = undecided ? t('wiz_privacy_blocked')
      : next.disabled ? t('wiz_finish_blocked') : '';

    _overlay.querySelector('#wiz-skip').textContent = t('wiz_later');

    const body = _overlay.querySelector('#wiz-body');
    body.innerHTML = '';
    (RENDER[step.id] || (() => {}))(body, step);
  }

  // ── Steps ────────────────────────────────────────────────────────────────
  async function saveSetting(patch) {
    Object.assign(_settings, patch);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: patch }),
      });
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('settings-changed', { detail: { ..._settings } }));
  }

  function badge(step) {
    return step?.is_new ? `<span class="wiz-new">${t('wiz_new')}</span>` : '';
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // One <option> list builder for every regional select, so a row is one line
  // and the "which value is selected" logic exists once instead of six times.
  function options(list, current) {
    return list.map(item => {
      const value = typeof item === 'string' ? item : item.value;
      const label = typeof item === 'string' ? item.replace(/_/g, ' ') : item.label;
      return `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
  }

  const RENDER = {
    welcome(body) {
      const version = _state?.version || '';
      body.innerHTML = `
        <div class="wiz-welcome">
          <img class="wiz-welcome-logo" src="/logo.png" alt="mvmOS">
          <div class="wiz-welcome-title">${t('wiz_step_welcome_heading')}</div>
          <p class="wiz-welcome-lead">${t('wiz_step_welcome_lead')}</p>
          ${version ? `<div class="wiz-welcome-version">
            <span class="wiz-welcome-version-label">${t('wiz_step_welcome_version')}</span>
            <span class="wiz-welcome-version-num">${esc(version)}</span>
          </div>` : ''}
        </div>`;
    },

    regional(body) {
      const s = _settings;
      const zones = Settings.TIMEZONES || [];
      const times = [
        { value: '24', label: t('regional_24h') },
        { value: '12', label: t('regional_12h') },
      ];
      const dates = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
      const weeks = [
        { value: 'monday', label: t('regional_monday') },
        { value: 'sunday', label: t('regional_sunday') },
      ];
      body.innerHTML = `
        <p class="wiz-lead">${t('wiz_step_regional_lead')}</p>
        <div class="wiz-row">
          <label for="wiz-lang">${t('regional_language')}</label>
          <select id="wiz-lang">${options(Settings.LANGUAGES || [], s.language || 'en')}</select>
        </div>
        <div class="wiz-row">
          <label for="wiz-curr">${t('regional_currency')}</label>
          <select id="wiz-curr">${options(Settings.CURRENCIES || [], s.currency || 'EUR')}</select>
        </div>
        <div class="wiz-row">
          <label for="wiz-tz">${t('regional_timezone')}</label>
          <select id="wiz-tz">${options(zones, s.timezone)}</select>
        </div>
        <div class="wiz-row">
          <label for="wiz-time">${t('regional_time_format')}</label>
          <select id="wiz-time">${options(times, s.time_format === '12' ? '12' : '24')}</select>
        </div>
        <div class="wiz-row">
          <label for="wiz-date">${t('regional_date_format')}</label>
          <select id="wiz-date">${options(dates, s.date_format || 'DD/MM/YYYY')}</select>
        </div>
        <div class="wiz-row">
          <label for="wiz-week">${t('regional_week_starts')}</label>
          <select id="wiz-week">${options(weeks, s.week_starts === 'sunday' ? 'sunday' : 'monday')}</select>
        </div>
        <p class="wiz-note">${t('wiz_step_regional_note')}</p>`;

      // Every row saves the one key it owns; the backend merges, so no row can
      // overwrite a choice made on another row.
      const bind = (id, key) => body.querySelector(id).addEventListener(
        'change', e => saveSetting({ [key]: e.target.value }));
      bind('#wiz-lang', 'language');
      bind('#wiz-curr', 'currency');
      bind('#wiz-tz', 'timezone');
      bind('#wiz-time', 'time_format');
      bind('#wiz-date', 'date_format');
      bind('#wiz-week', 'week_starts');
    },

    privacy(body, step) {
      const chosen = _settings.analytics;   // true, false, or never answered
      body.innerHTML = `
        <p class="wiz-lead">${t('wiz_step_privacy_lead')}</p>
        <div class="wiz-check">
          <label class="toggle"><input type="checkbox" id="wiz-errors"><span class="toggle-slider"></span></label>
          <div>
            <div class="wiz-check-title">${t('system_send_error_reports')}</div>
            <div class="wiz-check-desc">${t('system_error_reports_desc')}</div>
          </div>
        </div>
        <div class="wiz-check" style="padding-bottom:0">
          <div>
            <div class="wiz-check-title">${t('system_analytics')} ${badge(step)}</div>
            <div class="wiz-check-desc">${t('system_analytics_desc')}</div>
          </div>
        </div>
        <p class="wiz-note">${t('system_analytics_detail')}</p>
        <p class="wiz-note wiz-note-strong">${t('system_analytics_never')}</p>
        <p class="wiz-note">${t('system_analytics_purpose')}</p>
        <div class="wiz-choice">
          <button type="button" class="wiz-choice-btn${chosen === true ? ' picked' : ''}" id="wiz-stats-yes">
            <span class="wiz-choice-label">${t('wiz_analytics_yes')}</span>
            <span class="wiz-choice-rec">${t('wiz_analytics_recommended')}</span>
          </button>
          <button type="button" class="wiz-choice-btn${chosen === false ? ' picked' : ''}" id="wiz-stats-no">
            <span class="wiz-choice-label">${t('wiz_analytics_no')}</span>
          </button>
        </div>`;
      const errors = body.querySelector('#wiz-errors');
      errors.checked = _settings.error_reporting !== false;
      errors.addEventListener('change', () => {
        saveSetting({ error_reporting: errors.checked });
        window.dispatchEvent(new CustomEvent('error-reporting-changed', { detail: errors.checked }));
      });
      // Two buttons rather than a switch, and one of them has to be pressed.
      // A pre-ticked box would have collected far more yeses and none of them
      // would have been worth anything: a default nobody touched is not a
      // choice, and the privacy notice promises this is off until somebody
      // turns it on. Recommending one side is honest — assuming it is not.
      // Skipping the wizard on this step answers nothing and leaves it off.
      const pick = async (value) => { await saveSetting({ analytics: value }); paint(); };
      body.querySelector('#wiz-stats-yes').onclick = () => pick(true);
      body.querySelector('#wiz-stats-no').onclick = () => pick(false);
    },

    apps(body) {
      body.innerHTML = `
        <p class="wiz-lead">${t('wiz_step_apps_lead')}</p>
        <div class="wiz-store" id="wiz-store"></div>`;
      const host = body.querySelector('#wiz-store');
      // The real App Store, not a copy of it: installing from here is the same
      // code path as installing from the store window, so nothing can drift.
      // If that entry point ever goes away, the step still has to lead
      // somewhere, so it falls back to opening the store window instead of
      // throwing and leaving an empty page behind.
      // AppStore and Desktop are top-level const declarations in their own
      // files, which does not put them on window — they are reached by their
      // bare names, through the shared script scope.
      if (typeof AppStore?.render !== 'function') {
        host.innerHTML = `<div class="wiz-store-fallback">
          <button type="button" class="s-btn" id="wiz-open-store">${t('wiz_step_apps_open')}</button>
        </div>`;
        host.querySelector('#wiz-open-store').onclick = () => handOver(() => AppStore?.openWindow?.());
        return;
      }
      AppStore.render(host);
      // The store window calls this after rendering; the wizard hosts the same
      // markup, so without it the sidebar has no way to open on a phone.
      Desktop?.initMobileSidebar?.(host);
      // Its mvmOS app tab is filled in asynchronously; open it as soon as it
      // exists so the wizard lands on apps rather than on Linux packages.
      let tries = 0;
      const timer = setInterval(() => {
        if (!host.isConnected) { clearInterval(timer); return; }
        const tab = host.querySelector('#as-store-tabs .as-tab');
        if (tab) { tab.click(); clearInterval(timer); }
        else if (++tries > 40) clearInterval(timer);
      }, 50);
    },

    premium(body, step) {
      body.innerHTML = `
        <p class="wiz-lead">${t('wiz_step_premium_lead')}</p>
        <div class="wiz-premium">
          <div class="wiz-premium-icon">💎</div>
          <div class="wiz-premium-copy">${t('wiz_step_premium_desc')} ${badge(step)}</div>
        </div>
        <button class="s-btn s-btn-primary" id="wiz-premium-open">${t('wiz_step_premium_open')}</button>
        <p class="wiz-note">${t('wiz_step_premium_note')}</p>`;
      // The same subscription panel the rest of the system opens — the wizard
      // does not carry a second copy of it.
      body.querySelector('#wiz-premium-open').onclick = () =>
        handOver(() => window.dispatchEvent(new CustomEvent('open-subscription-settings')));
    },
  };

  return { open, close, load, reset, complete, isPending, newStepIds, maybeAutoRun,
           get state() { return _state; } };
})();

// The module is declared with const, which does not create a window property —
// desktop.js and settings.js reach for it there, so publish it explicitly.
window.Wizard = Wizard;
