/**
 * Automations editor — shared by the desktop window (frontend/automations.js)
 * and the public page (backend/automations_pub/index.html).
 *
 *   AutomationsUI.mount(el, { base, headers: () => ({...}), onAuth })
 *
 * A rule is built top to bottom: the app and what happens in it (or a time of
 * day), optional conditions, then what to do. The trigger app is chosen once;
 * its own functions are offered first everywhere after that. Other apps are
 * listed only when the server allows rules between apps — otherwise they are
 * simply not there.
 */
window.AutomationsUI = (() => {
  const t = (k, v) => (window.t ? window.t(k, v) : k);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // An app's name in the viewer's language (name_i18n / name_key from the server).
  const _an = a => (window.mvmOS?.appName ? window.mvmOS.appName(a) : a.name);
  const OPS = ['>', '>=', '<', '<=', '==', '!='];
  const OP_LABEL = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '==': '=', '!=': '≠' };

  const CSS = `
  .au{display:flex;flex-direction:column;gap:12px;font-size:.88rem;color:var(--text,var(--fg,#cdd6f4))}
  .au *{box-sizing:border-box}
  .au-top{display:flex;align-items:center;gap:8px}
  .au-top .au-grow{flex:1;min-width:0;color:var(--text-dim,var(--fg2,#a6adc8));font-size:.8rem}
  .au-btn{font:inherit;font-size:.82rem;font-weight:600;cursor:pointer;border-radius:8px;padding:7px 12px;border:1px solid var(--border,#45475a);background:var(--surface2,var(--surface,#313244));color:inherit;white-space:nowrap}
  .au-btn:hover{opacity:.88}
  .au-btn.pri{background:var(--accent,#89b4fa);border-color:transparent;color:#1e1e2e}
  .au-btn.dang{color:#f38ba8}
  .au-btn.sm{padding:4px 9px;font-size:.76rem;font-weight:500}
  .au-btn.link{border:0;background:none;color:var(--accent,#89b4fa);padding:4px 0}
  .au-card{border:1px solid var(--border,#45475a);border-radius:10px;padding:12px;background:var(--surface1,var(--surface,#181825));display:flex;flex-direction:column;gap:8px}
  .au-rule-head{display:flex;align-items:center;gap:10px}
  .au-rule-name{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .au-sum{color:var(--text-dim,var(--fg2,#a6adc8));font-size:.8rem;line-height:1.5;word-break:break-word}
  .au-acts{display:flex;gap:6px;flex-wrap:wrap}
  .au-st{font-size:.74rem;color:var(--text-dim,var(--fg2,#a6adc8))}
  .au-st.ok{color:#a6e3a1}.au-st.failed,.au-st.premium{color:#f38ba8}.au-st.limited{color:#f9e2af}
  .au-log{font-size:.76rem;display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--border,#45475a);padding-top:8px}
  .au-log div{word-break:break-word}
  .au-empty{color:var(--text-dim,var(--fg2,#a6adc8));text-align:center;padding:24px 8px;line-height:1.6}
  .au-sec{display:flex;flex-direction:column;gap:8px}
  .au-h{font-weight:700;font-size:.92rem;display:flex;align-items:baseline;gap:8px}
  .au-h small{font-weight:400;color:var(--text-dim,var(--fg2,#a6adc8));font-size:.76rem}
  .au-row{display:grid;grid-template-columns:minmax(96px,32%) minmax(0,1fr);gap:8px;align-items:center}
  .au-row>label{color:var(--text-dim,var(--fg2,#a6adc8));font-size:.8rem;overflow-wrap:anywhere}
  .au-pair{display:grid;grid-template-columns:72px minmax(0,1fr);gap:8px}
  .au input[type=text],.au input[type=number],.au input[type=time],.au select{width:100%;min-width:0;font:inherit;font-size:.85rem;padding:7px 9px;border-radius:7px;border:1px solid var(--border,#45475a);background:var(--input-bg,var(--surface2,#313244));color:inherit}
  .au-hint{font-size:.76rem;color:var(--text-dim,var(--fg2,#a6adc8));line-height:1.45}
  .au-step{position:relative;padding-top:30px}
  .au-step .au-x{position:absolute;top:6px;right:6px}
  .au-step .au-n{position:absolute;top:9px;left:12px;font-size:.74rem;color:var(--text-dim,var(--fg2,#a6adc8))}
  .au-chk{display:flex;align-items:center;gap:8px;cursor:pointer}
  .au-err{color:#f38ba8;font-size:.82rem;min-height:1em}
  .au-foot{display:flex;gap:8px;justify-content:flex-end}
  .au-sw{position:relative;width:36px;height:20px;flex-shrink:0}
  .au-sw input{opacity:0;width:0;height:0}
  .au-sw span{position:absolute;inset:0;border-radius:20px;background:var(--border,#45475a);cursor:pointer;transition:.15s}
  .au-sw span:before{content:'';position:absolute;width:14px;height:14px;left:3px;top:3px;border-radius:50%;background:#fff;transition:.15s}
  .au-sw input:checked+span{background:var(--accent,#89b4fa)}
  .au-sw input:checked+span:before{transform:translateX(16px)}
  `;

  function mount(el, opts) {
    const base = opts.base || '/pub/automations';
    let meta = null;
    let rules = [];
    let draft = null;          // the rule being edited, or null for the list
    const fieldCache = {};     // app|fn -> [{id,label,value}]
    const eventOptCache = {};  // app|event|param -> [{value,label}]
    const optionCache = {};    // app|fn|param -> [{value,label}]

    if (!document.getElementById('au-style')) {
      const st = document.createElement('style');
      st.id = 'au-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    async function api(path, init) {
      init = init || {};
      init.headers = Object.assign({}, opts.headers ? opts.headers() : {}, init.headers || {});
      const res = await fetch(base + '/api' + path, init);
      if (res.status === 401 && opts.onAuth) opts.onAuth();
      return res;
    }
    async function errText(res) {
      let d = '';
      try { d = (await res.json()).detail || ''; } catch (_) {}
      if (res.status === 402) return t('auto_cross_off');
      if (typeof d === 'string' && d.startsWith('auto_')) return t(d);
      return typeof d === 'string' && d && res.status === 400 ? d : t('auto_error_generic');
    }

    const appOf = id => (meta?.apps || []).find(a => a.id === id);
    const visibleApps = trig => (meta?.cross ? meta.apps : meta.apps.filter(a => a.id === trig));
    const otherApps = trig => (meta?.cross ? meta.apps.filter(a => a.id !== trig) : []);

    async function loadMeta() {
      const res = await api('/meta');
      if (!res.ok) throw res;
      meta = await res.json();
    }
    async function loadRules() {
      const res = await api('/rules');
      if (!res.ok) throw res;
      rules = (await res.json()).rules;
    }

    async function start() {
      el.innerHTML = `<div class="au"><div class="au-empty">${esc(t('loading'))}</div></div>`;
      try { await Promise.all([loadMeta(), loadRules()]); }
      catch (res) {
        el.innerHTML = `<div class="au"><div class="au-empty">${esc(res instanceof Response ? await errText(res) : t('auto_error_generic'))}</div></div>`;
        return;
      }
      render();
    }

    // The owner switched rules between apps on or off in Settings: show or
    // drop the other apps straight away, keeping whatever is being edited.
    const onSettings = async () => {
      try { await loadMeta(); } catch (_) { return; }
      render();
    };
    window.addEventListener('automations-settings-changed', onSettings);

    function render() {
      if (draft) renderEditor(); else renderList();
    }

    // ── List ─────────────────────────────────────────────────────────
    function eventLabel(app, id) {
      const e = (appOf(app)?.events || []).find(x => x.id === id);
      return e ? e.label : id;
    }
    function actionLabel(trig, a) {
      if (a.type === 'notify') return t('auto_notify');
      if (a.type === 'webhook') return t('auto_webhook');
      const app = appOf(a.app);
      const fn = (app?.actions || []).find(x => x.id === a.fn);
      return (a.app !== trig && app ? app.icon + ' ' + _an(app) + ' · ' : '') + (fn ? fn.label : a.fn);
    }
    function summary(r) {
      const app = appOf(r.trigger.app);
      const when = r.trigger.time ? t('auto_when_time', { time: r.trigger.time }) : eventLabel(r.trigger.app, r.trigger.event);
      const head = (app ? app.icon + ' ' + _an(app) : r.trigger.app) + ' · ' + when;
      const cond = r.conditions.length ? ' · ' + t('auto_if_n', { n: r.conditions.length }) : '';
      return head + cond + ' → ' + r.actions.map(a => actionLabel(r.trigger.app, a)).join(', ');
    }
    function statusText(s) {
      return s ? t('auto_status_' + s) : t('auto_never');
    }
    function when(iso) {
      try { return new Date(iso).toLocaleString(); } catch (_) { return iso; }
    }

    function renderList() {
      el.innerHTML = `<div class="au">
        <div class="au-top">
          <div class="au-grow">${esc(t('auto_intro'))}</div>
          <button class="au-btn pri" data-new>＋ ${esc(t('auto_new'))}</button>
        </div>
        ${!meta.apps.length ? `<div class="au-empty">${esc(t('auto_no_apps'))}</div>` : ''}
        ${meta.apps.length && !rules.length ? `<div class="au-empty">${esc(t('auto_empty'))}</div>` : ''}
        ${rules.map(r => `
          <div class="au-card" data-id="${r.id}">
            <div class="au-rule-head">
              <label class="au-sw" title="${esc(t('auto_enabled'))}"><input type="checkbox" data-on ${r.enabled ? 'checked' : ''}><span></span></label>
              <div class="au-rule-name">${esc(r.name)}</div>
            </div>
            <div class="au-sum">${esc(summary(r))}</div>
            <div class="au-st ${esc(r.last_status || '')}">${esc(statusText(r.last_status))}${r.last_run ? ' · ' + esc(when(r.last_run)) : ''}</div>
            <div class="au-acts">
              <button class="au-btn sm" data-edit>${esc(t('auto_edit'))}</button>
              <button class="au-btn sm" data-run>${esc(t('auto_run'))}</button>
              <button class="au-btn sm" data-log>${esc(t('auto_log'))}</button>
              <button class="au-btn sm dang" data-del>${esc(t('auto_delete'))}</button>
            </div>
            <div class="au-log" hidden></div>
          </div>`).join('')}
      </div>`;
      el.querySelector('[data-new]').addEventListener('click', () => openEditor(null));
      if (!meta.apps.length) el.querySelector('[data-new]').disabled = true;
      el.querySelectorAll('.au-card[data-id]').forEach(card => {
        const id = +card.dataset.id;
        const rule = rules.find(r => r.id === id);
        card.querySelector('[data-on]').addEventListener('change', async e => {
          const res = await api(`/rules/${id}/enabled`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: e.target.checked }) });
          if (!res.ok) { e.target.checked = !e.target.checked; alert(await errText(res)); return; }
          rule.enabled = e.target.checked;
        });
        card.querySelector('[data-edit]').addEventListener('click', () => openEditor(rule));
        card.querySelector('[data-del]').addEventListener('click', async () => {
          if (!confirm(t('auto_delete_confirm'))) return;
          const res = await api(`/rules/${id}`, { method: 'DELETE' });
          if (!res.ok) { alert(await errText(res)); return; }
          rules = rules.filter(r => r.id !== id);
          renderList();
        });
        card.querySelector('[data-run]').addEventListener('click', async e => {
          e.target.disabled = true;
          const res = await api(`/rules/${id}/run`, { method: 'POST' });
          e.target.disabled = false;
          if (!res.ok) { alert(await errText(res)); return; }
          await loadRules();
          renderList();
          showLog(el.querySelector(`.au-card[data-id="${id}"]`), id);
        });
        card.querySelector('[data-log]').addEventListener('click', () => {
          const box = card.querySelector('.au-log');
          if (!box.hidden) { box.hidden = true; return; }
          showLog(card, id);
        });
      });
    }

    async function showLog(card, id) {
      const box = card?.querySelector('.au-log');
      if (!box) return;
      box.hidden = false;
      box.textContent = t('loading');
      const res = await api(`/rules/${id}/log`);
      if (!res.ok) { box.textContent = await errText(res); return; }
      const log = (await res.json()).log;
      box.innerHTML = log.length ? log.map(l =>
        `<div><span class="au-st ${esc(l.status)}">${esc(statusText(l.status))}</span> · ${esc(when(l.ran_at))}${l.detail ? ' — ' + esc(l.detail) : ''}</div>`).join('')
        : `<div class="au-st">${esc(t('auto_log_empty'))}</div>`;
    }

    // ── Editor ───────────────────────────────────────────────────────
    function openEditor(rule) {
      draft = rule ? JSON.parse(JSON.stringify(rule)) : {
        name: '', enabled: true, trigger: { app: meta.apps[0]?.id || '', event: '', time: '' },
        conditions: [], match: 'all', actions: [], limit: 'none',
      };
      draft.trigger.time = draft.trigger.time || '';
      draft.trigger.event = draft.trigger.event || '';
      // Re-read what is allowed every time the editor opens: the Settings
      // switch may have changed since the window was opened.
      loadMeta().then(render, render);
    }

    const opt = (value, label, selected) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;

    function renderEditor() {
      const d = draft;
      const trig = appOf(d.trigger.app);
      const triggerSel = d.trigger.time !== '' || d.trigger.event === '' && d._time ? '@time' : d.trigger.event;
      const evOpts = (trig?.events || []).map(e => opt(e.id, e.label, e.id === d.trigger.event)).join('');
      const evSummary = (trig?.events || []).find(e => e.id === d.trigger.event)?.summary || '';
      const hasReads = visibleApps(d.trigger.app).some(a => a.reads.length) || eventFields().length > 0;

      el.innerHTML = `<div class="au">
        <div class="au-card au-sec">
          <div class="au-row"><label>${esc(t('auto_name'))}</label><input type="text" data-k="name" maxlength="${meta.limits.name}" placeholder="${esc(t('auto_name_ph'))}" value="${esc(d.name)}"></div>
        </div>

        <div class="au-card au-sec">
          <div class="au-h">1. ${esc(t('auto_when'))}</div>
          <div class="au-row"><label>${esc(t('auto_app'))}</label>
            <select data-k="app">${meta.apps.map(a => opt(a.id, a.icon + ' ' + _an(a), a.id === d.trigger.app)).join('')}</select></div>
          <div class="au-row"><label>${esc(t('auto_event'))}</label>
            <select data-k="event">${opt('', t('auto_choose'), !triggerSel)}${opt('@time', t('auto_every_day'), triggerSel === '@time')}${evOpts}</select></div>
          ${triggerSel === '@time' ? `<div class="au-row"><label>${esc(t('auto_time'))}</label><input type="time" data-k="time" value="${esc(d.trigger.time)}"></div>` : ''}
          ${evSummary ? `<div class="au-hint">${esc(evSummary)}</div>` : ''}
        </div>

        <div class="au-card au-sec">
          <div class="au-h">2. ${esc(t('auto_if'))} <small>${esc(t('auto_optional'))}</small></div>
          ${d.conditions.length > 1 ? `<div class="au-row"><label>${esc(t('auto_match'))}</label><select data-k="match">${opt('all', t('auto_match_all'), d.match !== 'any')}${opt('any', t('auto_match_any'), d.match === 'any')}</select></div>` : ''}
          ${d.conditions.map((c, i) => conditionHtml(c, i)).join('')}
          ${hasReads ? `<div><button class="au-btn link" data-add-cond>＋ ${esc(t('auto_add_condition'))}</button></div>` : `<div class="au-hint">${esc(t('auto_no_values'))}</div>`}
        </div>

        <div class="au-card au-sec">
          <div class="au-h">3. ${esc(t('auto_then'))}</div>
          ${d.actions.map((a, i) => actionHtml(a, i)).join('')}
          <div><button class="au-btn link" data-add-act>＋ ${esc(t('auto_add_action'))}</button></div>
        </div>

        <label class="au-chk"><input type="checkbox" data-k="limit" ${d.limit === 'day' ? 'checked' : ''}> ${esc(t('auto_once_day'))}</label>
        <div class="au-err" data-err></div>
        <div class="au-foot">
          <button class="au-btn" data-cancel>${esc(t('auto_cancel'))}</button>
          <button class="au-btn pri" data-save>${esc(t('auto_save'))}</button>
        </div>
      </div>`;
      wireEditor();
    }

    // The values the trigger's event itself carries, such as which task.
    function eventFields() {
      if (!draft || !draft.trigger.event) return [];
      return ((appOf(draft.trigger.app)?.events || []).find(e => e.id === draft.trigger.event)?.fields) || [];
    }

    function sourceOptions(trigId, current) {
      const own = appOf(trigId);
      let html = opt('', t('auto_choose'), !current);
      const evf = eventFields();
      if (evf.length) html += `<optgroup label="${esc(t('auto_this_event'))}">${evf.map(f => opt('@event|' + f.id, f.label, current === '@event|' + f.id)).join('')}</optgroup>`;
      const group = (app) => `<optgroup label="${esc(app.icon + ' ' + _an(app))}">${app.reads.map(r => opt(app.id + '|' + r.id, r.label, current === app.id + '|' + r.id)).join('')}</optgroup>`;
      if (own?.reads.length) html += group(own);
      otherApps(trigId).filter(a => a.reads.length).forEach(a => { html += group(a); });
      if (current && !html.includes(`value="${esc(current)}"`)) {
        const [app, fn] = current.split('|');
        const a = appOf(app);
        html += opt(current, (a ? a.icon + ' ' + _an(a) + ' · ' : '') + ((a?.reads || []).find(r => r.id === fn)?.label || fn), true);
      }
      return html;
    }

    function eventConditionHtml(c, i) {
      const f = eventFields().find(x => x.id === c.param);
      const text = f?.type !== 'number';
      const ops = text ? ['==', '!='] : OPS;
      let input;
      if (f?.pick) {
        const list = eventOptCache[draft.trigger.app + '|' + draft.trigger.event + '|' + f.id];
        if (!list) input = `<select disabled>${opt('', t('loading'), true)}</select>`;
        else {
          const v = String(c.value ?? '');
          const known = list.some(o => String(o.value) === v);
          input = `<select data-c="value">${opt('', t('auto_choose'), !v)}${!known && v ? opt(v, v, true) : ''}${list.map(o => opt(o.value, o.label, String(o.value) === v)).join('')}</select>`;
        }
      } else {
        input = `<input type="${text ? 'text' : 'number'}" ${text ? 'maxlength="500"' : 'step="any"'} data-c="value" value="${esc(c.value ?? '')}" placeholder="${text ? '' : '0'}">`;
      }
      return `<div class="au-card au-step" data-cond="${i}">
        <span class="au-n">${esc(t('auto_condition'))} ${i + 1}</span>
        <button class="au-btn sm au-x" data-del-cond title="${esc(t('auto_remove'))}">✕</button>
        <div class="au-row"><label>${esc(t('auto_value'))}</label><select data-c="src">${sourceOptions(draft.trigger.app, '@event|' + (c.param || ''))}</select></div>
        <div class="au-row"><label>${esc(t('auto_compare'))}</label>
          <div class="au-pair"><select data-c="op">${ops.map(o => opt(o, OP_LABEL[o], o === (ops.includes(c.op) ? c.op : ops[0]))).join('')}</select>${input}</div></div>
        <div class="au-hint">${esc(t('auto_event_hint'))}</div>
      </div>`;
    }

    function conditionHtml(c, i) {
      if (c.source === 'event') return eventConditionHtml(c, i);
      const key = c.app && c.fn ? c.app + '|' + c.fn : '';
      const fields = fieldCache[key];
      let fieldSel;
      if (!key) fieldSel = `<select disabled>${opt('', '—', true)}</select>`;
      else if (!fields) fieldSel = `<select disabled>${opt('', t('loading'), true)}</select>`;
      else {
        const known = fields.some(f => f.id === c.field);
        fieldSel = `<select data-c="field">${opt('', t('auto_choose'), !c.field)}${!known && c.field ? opt(c.field, c.field, true) : ''}${fields.map(f => opt(f.id, `${f.label} (${t('auto_now')}: ${f.value})`, f.id === c.field)).join('')}</select>`;
      }
      return `<div class="au-card au-step" data-cond="${i}">
        <span class="au-n">${esc(t('auto_condition'))} ${i + 1}</span>
        <button class="au-btn sm au-x" data-del-cond title="${esc(t('auto_remove'))}">✕</button>
        <div class="au-row"><label>${esc(t('auto_value'))}</label><select data-c="src">${sourceOptions(draft.trigger.app, key)}</select></div>
        ${!meta.cross && c.app && c.app !== draft.trigger.app ? `<div class="au-hint au-st failed">${esc(t('auto_cross_off'))}</div>` : ''}
        <div class="au-row"><label>${esc(t('auto_field'))}</label>${fieldSel}</div>
        <div class="au-row"><label>${esc(t('auto_compare'))}</label>
          <div class="au-pair"><select data-c="op">${OPS.map(o => opt(o, OP_LABEL[o], o === (c.op || '>='))).join('')}</select>
          <input type="number" step="any" data-c="value" value="${esc(c.value ?? '')}" placeholder="0"></div></div>
      </div>`;
    }

    function actionKey(a) {
      if (!a.type) return '';
      if (a.type === 'call') return 'call|' + a.app + '|' + a.fn;
      return a.type;
    }

    function actionOptions(trigId, current) {
      const own = appOf(trigId);
      let html = opt('', t('auto_choose'), !current);
      const group = app => app.actions.length
        ? `<optgroup label="${esc(app.icon + ' ' + _an(app))}">${app.actions.map(x => opt('call|' + app.id + '|' + x.id, x.label, current === 'call|' + app.id + '|' + x.id)).join('')}</optgroup>` : '';
      if (own) html += group(own);
      html += `<optgroup label="${esc(t('auto_messages'))}">${opt('notify', '🔔 ' + t('auto_notify'), current === 'notify')}${meta.cross ? opt('webhook', '🌐 ' + t('auto_webhook'), current === 'webhook') : ''}</optgroup>`;
      otherApps(trigId).forEach(a => { html += group(a); });
      if (current && !html.includes(`value="${esc(current)}"`)) html += opt(current, actionLabel(trigId, draft.actions.find(a => actionKey(a) === current) || {}), true);
      return html;
    }

    function paramInput(a, p, i) {
      const v = (a.params || {})[p.id];
      const name = `data-p="${esc(p.id)}"`;
      if (p.type === 'bool') {
        return `<select ${name}>${opt('', p.required ? t('auto_choose') : '—', v === undefined || v === '')}${opt('true', t('auto_yes'), v === true || v === 'true')}${opt('false', t('auto_no'), v === false || v === 'false')}</select>`;
      }
      if (p.pick) {
        const list = optionCache[a.app + '|' + a.fn + '|' + p.id];
        if (!list) return `<select disabled>${opt('', t('loading'), true)}</select>`;
        const known = list.some(o => String(o.value) === String(v ?? ''));
        return `<select ${name}>${opt('', p.required ? t('auto_choose') : '—', v === undefined || v === '')}${!known && v !== undefined && v !== '' ? opt(v, v, true) : ''}${list.map(o => opt(o.value, o.label, String(o.value) === String(v ?? ''))).join('')}</select>`;
      }
      const ph = p.default !== null && p.default !== undefined ? String(p.default) : (p.required ? '' : t('auto_optional'));
      return `<input type="${p.type === 'number' ? 'number' : 'text'}" ${p.type === 'number' ? 'step="any"' : ''} ${name} value="${esc(v ?? '')}" placeholder="${esc(ph)}">`;
    }

    function actionHtml(a, i) {
      const key = actionKey(a);
      let fields = '';
      let hint = '';
      if (a.type === 'notify') {
        fields = `<div class="au-row"><label>${esc(t('auto_notify_title'))}</label><input type="text" data-a="title" maxlength="120" value="${esc(a.title || '')}" placeholder="${esc(draft.name || '')}"></div>
          <div class="au-row"><label>${esc(t('auto_notify_body'))}</label><input type="text" data-a="body" maxlength="500" value="${esc(a.body || '')}"></div>`;
        hint = t('auto_hint_placeholders');
      } else if (a.type === 'webhook') {
        fields = `<div class="au-row"><label>${esc(t('auto_webhook_url'))}</label><input type="text" data-a="url" value="${esc(a.url || '')}" placeholder="https://"></div>
          <div class="au-row"><label>${esc(t('auto_webhook_body'))}</label><input type="text" data-a="body" maxlength="500" value="${esc(a.body || '')}"></div>`;
        hint = t('auto_webhook_hint');
      } else if (a.type === 'call') {
        const spec = (appOf(a.app)?.actions || []).find(x => x.id === a.fn);
        if (spec) {
          fields = spec.params.map(p => `<div class="au-row"><label>${esc(p.label)}${p.required ? ' *' : ''}</label>${paramInput(a, p, i)}</div>`).join('');
          hint = spec.summary;
        }
      }
      return `<div class="au-card au-step" data-act="${i}">
        <span class="au-n">${esc(t('auto_action'))} ${i + 1}</span>
        <button class="au-btn sm au-x" data-del-act title="${esc(t('auto_remove'))}">✕</button>
        <div class="au-row"><label>${esc(t('auto_do'))}</label><select data-a="kind">${actionOptions(draft.trigger.app, key)}</select></div>
        ${fields}
        ${hint ? `<div class="au-hint">${esc(hint)}</div>` : ''}
        ${!meta.cross && (a.type === 'webhook' || (a.type === 'call' && a.app !== draft.trigger.app)) ? `<div class="au-hint au-st failed">${esc(t('auto_cross_off'))}</div>` : ''}
      </div>`;
    }

    function loadFields(c) {
      const key = c.app + '|' + c.fn;
      if (!c.app || !c.fn || fieldCache[key]) return;
      api(`/fields?trigger=${encodeURIComponent(draft.trigger.app)}&app=${encodeURIComponent(c.app)}&fn=${encodeURIComponent(c.fn)}`)
        .then(r => (r.ok ? r.json() : { fields: [] }))
        .then(j => { fieldCache[key] = j.fields || []; if (draft) renderEditor(); })
        .catch(() => { fieldCache[key] = []; });
    }

    function loadEventOptions(c) {
      if (c.source !== 'event') return;
      const f = eventFields().find(x => x.id === c.param);
      if (!f?.pick) return;
      const key = draft.trigger.app + '|' + draft.trigger.event + '|' + f.id;
      if (key in eventOptCache) return;
      eventOptCache[key] = null;
      api(`/event-options?app=${encodeURIComponent(draft.trigger.app)}&event=${encodeURIComponent(draft.trigger.event)}&param=${encodeURIComponent(f.id)}`)
        .then(r => (r.ok ? r.json() : { options: [] }))
        .then(j => { eventOptCache[key] = j.options || []; if (draft) renderEditor(); })
        .catch(() => { eventOptCache[key] = []; if (draft) renderEditor(); });
    }

    function loadOptions(a) {
      if (a.type !== 'call') return;
      const spec = (appOf(a.app)?.actions || []).find(x => x.id === a.fn);
      (spec?.params || []).filter(p => p.pick).forEach(p => {
        const key = a.app + '|' + a.fn + '|' + p.id;
        if (optionCache[key]) return;
        optionCache[key] = null;
        api(`/options?trigger=${encodeURIComponent(draft.trigger.app)}&app=${encodeURIComponent(a.app)}&fn=${encodeURIComponent(a.fn)}&param=${encodeURIComponent(p.id)}`)
          .then(r => (r.ok ? r.json() : { options: [] }))
          .then(j => { optionCache[key] = j.options || []; if (draft) renderEditor(); })
          .catch(() => { optionCache[key] = []; if (draft) renderEditor(); });
      });
    }

    function readForm() {
      // Text fields are read on every change, so a re-render never loses typing.
      const q = s => el.querySelector(s);
      draft.name = q('[data-k="name"]').value;
      const time = q('[data-k="time"]');
      if (time) draft.trigger.time = time.value;
      draft.limit = q('[data-k="limit"]').checked ? 'day' : 'none';
      const match = q('[data-k="match"]');
      if (match) draft.match = match.value;
      el.querySelectorAll('[data-cond]').forEach(box => {
        const c = draft.conditions[+box.dataset.cond];
        c.op = box.querySelector('[data-c="op"]').value;
        const v = box.querySelector('[data-c="value"]');
        if (v) c.value = v.value;
        const f = box.querySelector('[data-c="field"]');
        if (f) c.field = f.value;
      });
      el.querySelectorAll('[data-act]').forEach(box => {
        const a = draft.actions[+box.dataset.act];
        box.querySelectorAll('[data-a="title"],[data-a="body"],[data-a="url"]').forEach(inp => { a[inp.dataset.a] = inp.value; });
        box.querySelectorAll('[data-p]').forEach(inp => {
          a.params = a.params || {};
          a.params[inp.dataset.p] = inp.value;
        });
      });
    }

    function wireEditor() {
      const q = s => el.querySelector(s);
      // Only the selects that change the shape of the form redraw it.
      q('[data-k="app"]').addEventListener('change', e => {
        readForm();
        draft.trigger = { app: e.target.value, event: '', time: '' };
        draft._time = false;
        // Without rules between apps, steps of the previous app no longer fit.
        const fits = app => app === draft.trigger.app || (meta.cross && appOf(app));
        draft.conditions = draft.conditions.filter(c => fits(c.app));
        draft.actions = draft.actions.filter(a => a.type !== 'call' || fits(a.app));
        renderEditor();
      });
      q('[data-k="event"]').addEventListener('change', e => {
        readForm();
        if (e.target.value === '@time') { draft.trigger.event = ''; draft.trigger.time = draft.trigger.time || '08:00'; draft._time = true; }
        else { draft.trigger.event = e.target.value; draft.trigger.time = ''; draft._time = false; }
        const ids = eventFields().map(f => f.id);
        draft.conditions = draft.conditions.filter(c => c.source !== 'event' || ids.includes(c.param));
        renderEditor();
      });
      q('[data-add-cond]')?.addEventListener('click', () => {
        readForm();
        if (draft.conditions.length >= meta.limits.conditions) return;
        const own = appOf(draft.trigger.app);
        const src = own?.reads.length ? own : visibleApps(draft.trigger.app).find(a => a.reads.length);
        if (!src) {
          draft.conditions.push({ source: 'event', param: eventFields()[0].id, op: '==', value: '' });
          loadEventOptions(draft.conditions[draft.conditions.length - 1]);
        } else {
          draft.conditions.push({ app: src.id, fn: src.reads[0].id, field: '', op: '>=', value: '' });
          loadFields(draft.conditions[draft.conditions.length - 1]);
        }
        renderEditor();
      });
      q('[data-add-act]').addEventListener('click', () => {
        readForm();
        if (draft.actions.length >= meta.limits.actions) return;
        draft.actions.push({ type: '' });
        renderEditor();
      });
      el.querySelectorAll('[data-cond]').forEach(box => {
        const i = +box.dataset.cond;
        box.querySelector('[data-del-cond]').addEventListener('click', () => { readForm(); draft.conditions.splice(i, 1); renderEditor(); });
        box.querySelector('[data-c="src"]').addEventListener('change', e => {
          readForm();
          const [app, fn] = e.target.value.split('|');
          if (app === '@event') {
            draft.conditions[i] = { source: 'event', param: fn, op: '==', value: '' };
            loadEventOptions(draft.conditions[i]);
          } else {
            draft.conditions[i] = { app: app || '', fn: fn || '', field: '', op: '>=', value: '' };
            loadFields(draft.conditions[i]);
          }
          renderEditor();
        });
      });
      el.querySelectorAll('[data-act]').forEach(box => {
        const i = +box.dataset.act;
        box.querySelector('[data-del-act]').addEventListener('click', () => { readForm(); draft.actions.splice(i, 1); renderEditor(); });
        box.querySelector('[data-a="kind"]').addEventListener('change', e => {
          readForm();
          const v = e.target.value;
          if (v.startsWith('call|')) {
            const [, app, fn] = v.split('|');
            draft.actions[i] = { type: 'call', app, fn, params: {} };
            loadOptions(draft.actions[i]);
          } else draft.actions[i] = { type: v, title: '', body: '', url: '' };
          renderEditor();
        });
      });
      draft.conditions.forEach(c => (c.source === 'event' ? loadEventOptions(c) : loadFields(c)));
      draft.actions.forEach(loadOptions);
      q('[data-cancel]').addEventListener('click', () => { draft = null; renderList(); });
      q('[data-save]').addEventListener('click', save);
    }

    async function save() {
      readForm();
      const err = el.querySelector('[data-err]');
      const d = draft;
      const body = {
        name: d.name.trim(),
        enabled: d.enabled !== false,
        trigger: d.trigger.event ? { app: d.trigger.app, event: d.trigger.event } : { app: d.trigger.app, time: d.trigger.time },
        conditions: d.conditions.map(c => (c.source === 'event'
          ? { source: 'event', param: c.param, op: c.op, value: c.value }
          : { app: c.app, fn: c.fn, field: c.field, op: c.op, value: c.value })),
        actions: d.actions.filter(a => a.type).map(a => {
          if (a.type === 'call') {
            const params = {};
            Object.entries(a.params || {}).forEach(([k, v]) => { if (v !== '' && v !== undefined) params[k] = v === 'true' ? true : v === 'false' ? false : v; });
            return { type: 'call', app: a.app, fn: a.fn, params };
          }
          if (a.type === 'webhook') return { type: 'webhook', url: a.url || '', body: a.body || '' };
          return { type: 'notify', title: a.title || '', body: a.body || '' };
        }),
        match: d.conditions.length > 1 && d.match === 'any' ? 'any' : 'all',
        limit: d.limit,
      };
      if (!body.name) { err.textContent = t('auto_error_name'); return; }
      if (!body.trigger.event && !body.trigger.time) { err.textContent = t('auto_error_trigger'); return; }
      if (body.conditions.some(c => (c.source === 'event' ? !c.param : !c.field) || c.value === '' || c.value == null)) { err.textContent = t('auto_error_condition'); return; }
      if (!body.actions.length) { err.textContent = t('auto_error_no_action'); return; }
      err.textContent = '';
      const btn = el.querySelector('[data-save]');
      btn.disabled = true;
      const res = await api(d.id ? `/rules/${d.id}` : '/rules', {
        method: d.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      btn.disabled = false;
      if (!res.ok) { err.textContent = await errText(res); return; }
      draft = null;
      await loadRules();
      renderList();
    }

    start();
    return {
      refresh: start,
      destroy() { window.removeEventListener('automations-settings-changed', onSettings); },
    };
  }

  return { mount };
})();
