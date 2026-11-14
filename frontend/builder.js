/**
 * mvmOS App Builder — the window where a person describes an app to the AI, tries it in a
 * live sandboxed preview, and then installs it or downloads it.
 *
 * The AI chat works on one project folder only (see backend/builder.py). The preview is
 * the same sandbox an installed app runs in (builder-runtime.js).
 */
const AppBuilder = (() => {
  const API = '/api/builder';
  const t = (k, v) => (window.t ? window.t(k, v) : k);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { body: null, status: null, view: 'home', project: null, tab: 'preview', handle: null, running: false,
                  pollTimer: null, reloadTimer: null, errors: [], phone: false, sending: false, token: 0 };

  function injectStyle() {
    if (document.getElementById('bld-style')) return;
    const s = document.createElement('style');
    s.id = 'bld-style';
    s.textContent = `
.bld{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--bg);color:var(--text);font-size:14px}
.bld *{box-sizing:border-box}
.bld button{font:inherit}
.bld-btn{background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 13px;cursor:pointer;white-space:nowrap}
.bld-btn:hover:not(:disabled){border-color:var(--accent)}
.bld-btn:disabled{opacity:.5;cursor:default}
.bld-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}
.bld-btn.danger{color:color-mix(in srgb,var(--danger) 55%,var(--text));border-color:color-mix(in srgb,var(--danger) 50%,var(--border))}
.bld-btn.small{padding:4px 9px;font-size:12.5px}
.bld input[type=text],.bld textarea,.bld select{width:100%;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font:inherit}
.bld textarea{resize:vertical}
.bld input:focus,.bld textarea:focus,.bld select:focus,.bld-btn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.bld-muted{color:var(--text-dim)}
.bld-banner{margin:12px 20px 0;padding:10px 14px;border-radius:10px;background:color-mix(in srgb,var(--accent) 14%,var(--surface));border:1px solid color-mix(in srgb,var(--accent) 40%,var(--border))}
.bld-banner.warn{background:color-mix(in srgb,var(--danger) 12%,var(--surface));border-color:color-mix(in srgb,var(--danger) 45%,var(--border))}
/* home */
.bld-home{flex:1;overflow:auto;padding:22px 24px}
.bld-home-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px}
.bld-home h2{margin:0 0 4px;font-size:1.5rem}
.bld-home-head p{margin:0;max-width:640px}
.bld-actions{display:flex;gap:8px;flex-wrap:wrap}
.bld-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin-top:18px}
.bld-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;cursor:pointer;transition:border-color .15s,transform .15s}
.bld-card:hover{border-color:var(--accent);transform:translateY(-1px)}
.bld-card-top{display:flex;gap:12px;align-items:center}
.bld-ico{width:52px;height:52px;border-radius:13px;flex:none;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:26px;overflow:hidden}
.bld-ico img{width:100%;height:100%;display:block}
.bld-card h3{margin:0;font-size:1.05rem;line-height:1.2;word-break:break-word}
.bld-meta{font-size:12.5px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.bld-chip{padding:2px 8px;border-radius:999px;background:var(--surface2);border:1px solid var(--border);font-size:12px;white-space:nowrap}
.bld-chip.ok{background:color-mix(in srgb,var(--accent) 18%,var(--surface));border-color:color-mix(in srgb,var(--accent) 50%,var(--border))}
.bld-card-actions{display:flex;gap:8px;margin-top:auto}
.bld-empty{margin:60px auto;text-align:center;max-width:420px}
.bld-empty .big{font-size:54px;line-height:1}
/* workspace */
.bld-top{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border);background:var(--surface);flex-wrap:wrap}
.bld-top .bld-ico{width:34px;height:34px;border-radius:9px;font-size:18px}
.bld-top .title{font-weight:600;font-size:1rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bld-top .grow{flex:1}
.bld-main{flex:1;display:flex;min-height:0}
.bld-chat{width:min(400px,42%);min-width:290px;display:flex;flex-direction:column;border-right:1px solid var(--border);min-height:0;background:var(--bg)}
.bld-log{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px;user-select:text}
.bld-msg{max-width:94%;padding:9px 12px;border-radius:12px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.bld-msg.user{align-self:flex-end;background:var(--accent);color:var(--on-accent);border-bottom-right-radius:4px}
.bld-msg.ai{align-self:flex-start;background:var(--surface);border:1px solid var(--border);border-bottom-left-radius:4px}
.bld-files-changed{font-size:12px;margin-top:6px;color:var(--text-dim)}
.bld-steps{align-self:stretch;display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--text-dim)}
.bld-step{display:flex;gap:6px;align-items:baseline}
.bld-step.bad{color:color-mix(in srgb,var(--danger) 55%,var(--text))}
.bld-work{align-self:flex-start;color:var(--text-dim);display:flex;gap:8px;align-items:center}
.bld-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:bldp 1s infinite ease-in-out}
@keyframes bldp{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}
@media (prefers-reduced-motion:reduce){.bld-dot{animation:none}}
.bld-compose{border-top:1px solid var(--border);padding:10px;display:flex;flex-direction:column;gap:8px;background:var(--surface)}
.bld-compose-row{display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap}
.bld-right{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.bld-tabs{display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--border);align-items:center;flex-wrap:wrap}
.bld-tab{background:none;border:0;border-bottom:2px solid transparent;color:var(--text-dim);padding:7px 12px;cursor:pointer;border-radius:6px 6px 0 0}
.bld-tab.active{color:var(--text);border-bottom-color:var(--accent);font-weight:600}
.bld-tabs .grow{flex:1}
.bld-pane{flex:1;min-height:0;display:flex;flex-direction:column}
.bld-stage{flex:1;min-height:0;background:var(--surface2);display:flex;align-items:stretch;justify-content:center;padding:0;position:relative;overflow:hidden}
.bld-stage.phone{padding:14px 0}
.bld-frame{width:100%;height:100%;background:var(--bg);position:relative}
.bld-stage.phone .bld-frame{width:390px;max-width:100%;border:1px solid var(--border);border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.35)}
.bld-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:30px;color:var(--text-dim)}
.bld-errbar{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:7px 12px;background:color-mix(in srgb,var(--danger) 14%,var(--surface));border-top:1px solid color-mix(in srgb,var(--danger) 45%,var(--border));font-size:13px;flex-wrap:wrap}
.bld-list{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.bld-row{display:flex;gap:10px;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:8px 12px}
.bld-row .name{font-family:var(--mono,monospace);font-size:13px;word-break:break-all}
.bld-editor{flex:1;display:flex;flex-direction:column;min-height:0;gap:8px;padding:12px 14px}
.bld-editor textarea{flex:1;font-family:var(--mono,monospace);font-size:12.5px;line-height:1.45;white-space:pre;tab-size:2}
.bld-check{padding:10px 14px;border-top:1px solid var(--border);max-height:34%;overflow:auto;font-size:13px}
.bld-check ul{margin:6px 0 0;padding-left:18px}
.bld-check li.err{color:color-mix(in srgb,var(--danger) 55%,var(--text))}
/* dialogs */
.bld-dlg{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:14px}
.bld-dlg-box{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:14px;padding:20px;width:min(520px,100%);max-height:100%;overflow:auto;display:flex;flex-direction:column;gap:12px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.bld-dlg-box h3{margin:0;font-size:1.15rem}
.bld-field{display:flex;flex-direction:column;gap:4px}
.bld-field label{font-weight:600}
.bld-check-row{display:flex;gap:10px;align-items:flex-start}
.bld-check-row input{margin-top:3px;flex:none;width:auto}
.bld-check-row small{display:block;color:var(--text-dim)}
.bld-langs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 12px}
.bld-lang{display:flex;gap:7px;align-items:center;cursor:pointer}
.bld-lang input{width:auto}
.bld-dlg-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
@media (max-width:760px){.bld-main{flex-direction:column}.bld-chat{width:100%;border-right:0;border-bottom:1px solid var(--border);min-height:46%}}
`;
    document.head.appendChild(s);
  }

  async function api(method, path, body) {
    const init = { method, headers: {} };
    if (window.mvmOS && mvmOS._pubHeaders) Object.assign(init.headers, { 'X-Pub-Token': localStorage.getItem('apphub_token') || '' });
    if (!init.headers['X-Pub-Token']) delete init.headers['X-Pub-Token'];
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const r = await fetch(API + path, init);
    let data = null;
    try { data = await r.json(); } catch (e) { /* none */ }
    if (!r.ok) { const err = new Error((data && (data.detail || data.error)) || ('HTTP ' + r.status)); err.status = r.status; throw err; }
    return data;
  }

  function when(ts) {
    try { return window.mvmOS?.dateTimePicker?.format ? new Date(ts * 1000).toLocaleDateString(window.mvmOS.lang) : new Date(ts * 1000).toLocaleDateString(); }
    catch (e) { return ''; }
  }

  function openWindow() {
    injectStyle();
    mvmOS.createWindow({
      id: 'app-builder', title: '🧱 ' + t('app_builder'), icon: '🧱', iconImage: '/icons/app-builder.svg', width: 1180, height: 740,
      onMount(body) { mount(body); },
      onClose() { teardown(); },
    });
  }

  function teardown() {
    stopPolling();
    if (state.handle) { state.handle.destroy(); state.handle = null; }
    clearTimeout(state.reloadTimer);
    state.body = null; state.project = null; state.view = 'home';
  }

  async function mount(body) {
    state.body = body;
    body.style.cssText = 'padding:0;overflow:hidden;height:100%;position:relative';
    body.innerHTML = '<div class="bld"><div class="bld-home bld-muted">…</div></div>';
    try { state.status = await api('GET', '/status'); } catch (e) { state.status = { ai: { available: false } }; }
    if (state.project) await openProject(state.project.id); else showHome();
  }

  const root = () => state.body && state.body.querySelector('.bld');

  // ── Home ──────────────────────────────────────────────────────────────────
  async function showHome() {
    if (!state.body) return;
    state.view = 'home';
    if (state.handle) { state.handle.destroy(); state.handle = null; }
    stopPolling();
    let list = [];
    try { list = (await api('GET', '/projects')).projects; } catch (e) { /* empty */ }
    if (!state.body || state.view !== 'home') return;
    const ai = state.status?.ai || {};
    let banner = '';
    if (!ai.available) {
      banner = `<div class="bld-banner warn">${esc(ai.reason === 'mvmai_missing' ? t('bld_ai_missing') : t('bld_ai_not_configured'))}</div>`;
    } else {
      banner = `<div class="bld-banner">${esc(t('bld_ai_using', { provider: ai.provider || '', model: ai.model || '' }))}</div>`;
    }
    state.body.innerHTML = `<div class="bld">${banner}
      <div class="bld-home">
        <div class="bld-home-head">
          <div><h2>${esc(t('bld_home_title'))}</h2><p class="bld-muted">${esc(t('bld_home_sub'))}</p></div>
          <div class="bld-actions"><button class="bld-btn" id="bld-import">${esc(t('bld_import'))}</button><button class="bld-btn primary" id="bld-new">${esc(t('bld_new'))}</button></div>
        </div>
        ${list.length ? `<div class="bld-grid">${list.map(cardHTML).join('')}</div>` : `<div class="bld-empty"><div class="big">🧱</div><h3>${esc(t('bld_empty_title'))}</h3><p class="bld-muted">${esc(t('bld_empty'))}</p><button class="bld-btn primary" id="bld-new2">${esc(t('bld_new'))}</button></div>`}
      </div></div>`;
    const b = state.body;
    b.querySelector('#bld-new')?.addEventListener('click', newDialog);
    b.querySelector('#bld-new2')?.addEventListener('click', newDialog);
    b.querySelector('#bld-import')?.addEventListener('click', importFlow);
    b.querySelectorAll('.bld-card').forEach(c => {
      c.addEventListener('click', e => { if (!e.target.closest('[data-del]')) openProject(c.dataset.id); });
      c.querySelector('[data-open]')?.addEventListener('click', e => { e.stopPropagation(); openProject(c.dataset.id); });
      c.querySelector('[data-del]')?.addEventListener('click', async e => {
        e.stopPropagation();
        const p = list.find(x => x.id === c.dataset.id);
        if (!await mvmOS.confirm(t('bld_delete_confirm', { name: p.name }), { ok: t('bld_delete'), cancel: t('bld_cancel'), danger: true })) return;
        try { await api('DELETE', '/projects/' + p.id); } catch (err) { mvmOS.toast(err.message); }
        showHome();
      });
    });
  }

  function iconHTML(p) {
    return p.has_icon ? `<img src="${API}/projects/${p.id}/icon?v=${Math.round(p.updated || 0)}" alt="" draggable="false">` : esc(p.emoji || '🧩');
  }

  function cardHTML(p) {
    const status = p.installed ? `<span class="bld-chip ok">${esc(t('bld_installed_v', { v: p.installed.version }))}</span>` : `<span class="bld-chip">${esc(t('bld_draft'))}</span>`;
    return `<div class="bld-card" data-id="${p.id}" tabindex="0">
      <div class="bld-card-top"><div class="bld-ico">${iconHTML(p)}</div><div style="min-width:0"><h3>${esc(p.name)}</h3><div class="bld-muted" style="font-size:12.5px">${esc(mvmOS.categoryName ? mvmOS.categoryName(p.category) : p.category)}</div></div></div>
      <div class="bld-meta">${status}${p.imported ? `<span class="bld-chip">${esc(t('bld_imported'))}</span>` : ''}${p.public ? `<span class="bld-chip">${esc(t('bld_chip_public'))}</span>` : ''}<span class="bld-muted">${esc(t('bld_updated', { when: when(p.updated) }))}</span></div>
      <div class="bld-card-actions"><button class="bld-btn small primary" data-open>${esc(t('bld_open'))}</button>${p.installed ? '' : `<button class="bld-btn small danger" data-del>${esc(t('bld_delete'))}</button>`}</div>
    </div>`;
  }

  // ── Dialogs ───────────────────────────────────────────────────────────────
  function dialog(html, wire) {
    const host = state.body.querySelector('.bld') || state.body;
    const wrap = document.createElement('div');
    wrap.className = 'bld-dlg';
    wrap.innerHTML = `<div class="bld-dlg-box" role="dialog" aria-modal="true">${html}</div>`;
    host.appendChild(wrap);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) wrap.remove(); });
    const close = () => wrap.remove();
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    wire(wrap, close);
    wrap.querySelector('input[type=text],textarea,button.primary')?.focus();
    return close;
  }

  const LANG_NAMES = { bg: 'Български', de: 'Deutsch', en: 'English', es: 'Español', fr: 'Français', ja: '日本語', 'pt-BR': 'Português (Brasil)', ru: 'Русский', 'zh-CN': '简体中文' };
  function languageBoxes(chosen, idPrefix) {
    const set = new Set(chosen);
    return (state.status?.langs || Object.keys(LANG_NAMES)).map(l => `<label class="bld-lang"><input type="checkbox" data-lang="${esc(l)}" ${set.has(l) ? 'checked' : ''}> ${esc(LANG_NAMES[l] || l)}</label>`).join('');
  }
  function pickedLanguages(wrap) {
    return [...wrap.querySelectorAll('[data-lang]')].filter(x => x.checked).map(x => x.dataset.lang);
  }

  function categoryOptions(sel) {
    return (state.status?.categories || []).map(c => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${esc(mvmOS.categoryName ? mvmOS.categoryName(c) : c)}</option>`).join('');
  }

  function newDialog() {
    dialog(`<h3>${esc(t('bld_new_title'))}</h3>
      <div class="bld-field"><label for="bld-n-name">${esc(t('bld_f_name'))}</label><input type="text" id="bld-n-name" maxlength="40"></div>
      <div class="bld-field"><label for="bld-n-cat">${esc(t('bld_f_category'))}</label><select id="bld-n-cat">${categoryOptions('Utilities')}</select></div>
      <div class="bld-field"><label for="bld-n-desc">${esc(t('bld_f_describe'))}</label><textarea id="bld-n-desc" rows="4" placeholder="${esc(t('bld_f_describe_ph'))}"></textarea></div>
      <div class="bld-check-row"><input type="checkbox" id="bld-n-prof"><label for="bld-n-prof"><b>${esc(t('bld_f_profiles'))}</b><small>${esc(t('bld_f_profiles_hint'))}</small></label></div>
      <div class="bld-check-row"><input type="checkbox" id="bld-n-pub"><label for="bld-n-pub"><b>${esc(t('bld_f_public'))}</b><small>${esc(t('bld_f_public_hint'))}</small></label></div>
      <div class="bld-field"><label>${esc(t('bld_f_languages'))}</label><div class="bld-langs">${languageBoxes(['en'])}</div><small class="bld-muted">${esc(t('bld_f_languages_hint'))}</small></div>
      <p class="bld-muted" id="bld-n-gamehint" style="margin:0;display:none">${esc(t('bld_f_game_hint'))}</p>
      <div class="bld-dlg-actions"><button class="bld-btn" data-x>${esc(t('bld_cancel'))}</button><button class="bld-btn primary" data-ok>${esc(t('bld_create'))}</button></div>`,
    (wrap, close) => {
      const $ = s => wrap.querySelector(s);
      $('#bld-n-pub').addEventListener('change', () => { if ($('#bld-n-pub').checked) $('#bld-n-prof').checked = true; });
      $('#bld-n-prof').addEventListener('change', () => { if (!$('#bld-n-prof').checked) $('#bld-n-pub').checked = false; });
      const game = () => { const g = $('#bld-n-cat').value === 'Games'; $('#bld-n-gamehint').style.display = g ? '' : 'none'; $('#bld-n-pub').disabled = g; if (g) $('#bld-n-pub').checked = false; };
      $('#bld-n-cat').addEventListener('change', game);
      $('[data-x]').onclick = close;
      $('[data-ok]').onclick = async () => {
        const name = $('#bld-n-name').value.trim();
        if (name.length < 2) { mvmOS.toast(t('bld_name_short')); $('#bld-n-name').focus(); return; }
        const desc = $('#bld-n-desc').value.trim();
        const languages = pickedLanguages(wrap);
        if (!languages.length) { mvmOS.toast(t('bld_lang_one')); return; }
        try {
          const p = await api('POST', '/projects', { name, category: $('#bld-n-cat').value, profiles: $('#bld-n-prof').checked, public: $('#bld-n-pub').checked, description: desc.slice(0, 300), languages });
          close();
          await openProject(p.id, desc ? t('bld_first_msg', { name, desc }) : '');
        } catch (e) { mvmOS.toast(e.message); }
      };
    });
  }

  async function importFlow() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.zip,application/zip';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        const r = await fetch(API + '/import', { method: 'POST', body: f });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.detail || data.error || ('HTTP ' + r.status));
        mvmOS.toast(t('bld_import_done', { name: data.name }));
        await openProject(data.id);
      } catch (e) { mvmOS.toast(t('bld_import_failed'), e.message); }
    };
    input.click();
  }

  // ── Workspace ─────────────────────────────────────────────────────────────
  async function openProject(pid, firstMessage) {
    if (!state.body) return;
    let p;
    try { p = await api('GET', '/projects/' + pid); } catch (e) { mvmOS.toast(e.message); return showHome(); }
    state.project = p; state.view = 'work'; state.tab = 'preview'; state.errors = []; state.running = false;
    if (state.handle) { state.handle.destroy(); state.handle = null; }
    drawWork();
    const hist = await api('GET', `/projects/${pid}/chat`).catch(() => ({ messages: [], running: null }));
    if (state.project?.id !== pid) return;
    renderHistory(hist.messages);
    await reloadPreview();
    if (hist.running) { setRunning(true); poll(hist.running, 0); }
    else if (firstMessage) send(firstMessage);
  }

  function projectBadge(p) { return p.installed ? `<span class="bld-chip ok">${esc(t('bld_installed_v', { v: p.installed.version }))}</span>` : `<span class="bld-chip">${esc(t('bld_draft'))}</span>`; }

  function drawWork() {
    const p = state.project;
    state.body.innerHTML = `<div class="bld">
      <div class="bld-top">
        <button class="bld-btn small" id="bld-back">← ${esc(t('bld_back'))}</button>
        <div class="bld-ico">${iconHTML(p)}</div>
        <div class="title">${esc(p.name)}</div>${projectBadge(p)}
        <div class="grow"></div>
        <button class="bld-btn small" id="bld-settings">⚙ ${esc(t('bld_settings'))}</button>
        <button class="bld-btn small" id="bld-download">⬇ ${esc(t('bld_download'))}</button>
        ${p.installed ? `<button class="bld-btn small" id="bld-open-app">${esc(t('bld_open_app'))}</button><button class="bld-btn small danger" id="bld-uninstall">${esc(t('bld_uninstall'))}</button>` : ''}
        <button class="bld-btn small primary" id="bld-install">${esc(p.installed ? t('bld_update') : t('bld_install'))}</button>
      </div>
      <div class="bld-main">
        <div class="bld-chat">
          <div class="bld-log" id="bld-log" aria-live="polite"></div>
          <div class="bld-compose">
            <textarea id="bld-input" rows="3" placeholder="${esc(t('bld_chat_ph'))}"></textarea>
            <div class="bld-compose-row">
              <button class="bld-btn small" id="bld-clear">${esc(t('bld_clear_chat'))}</button>
              <span><button class="bld-btn small danger" id="bld-stop" style="display:none">${esc(t('bld_stop'))}</button> <button class="bld-btn primary" id="bld-send">${esc(t('bld_send'))}</button></span>
            </div>
          </div>
        </div>
        <div class="bld-right">
          <div class="bld-tabs">
            <button class="bld-tab active" data-tab="preview">${esc(t('bld_tab_preview'))}</button>
            <button class="bld-tab" data-tab="files">${esc(t('bld_tab_files'))}</button>
            <button class="bld-tab" data-tab="versions">${esc(t('bld_tab_versions'))}</button>
            <div class="grow"></div>
            <span id="bld-preview-tools">
              <button class="bld-btn small" id="bld-phone" title="${esc(t('bld_phone'))}">📱</button>
              <button class="bld-btn small" id="bld-restart">↻ ${esc(t('bld_reload'))}</button>
              <button class="bld-btn small" id="bld-reset">${esc(t('bld_reset_data'))}</button>
            </span>
          </div>
          <div class="bld-pane" id="bld-pane"></div>
        </div>
      </div></div>`;
    const b = state.body;
    b.querySelector('#bld-back').onclick = () => { teardownPreview(); state.project = null; showHome(); };
    b.querySelector('#bld-settings').onclick = settingsDialog;
    b.querySelector('#bld-download').onclick = download;
    b.querySelector('#bld-install').onclick = installFlow;
    b.querySelector('#bld-open-app')?.addEventListener('click', () => mvmOS._apps?.[p.app_id]?.launch?.());
    b.querySelector('#bld-uninstall')?.addEventListener('click', uninstallFlow);
    b.querySelector('#bld-send').onclick = () => send();
    b.querySelector('#bld-stop').onclick = stopTurn;
    b.querySelector('#bld-clear').onclick = clearChat;
    b.querySelector('#bld-input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    b.querySelectorAll('.bld-tab').forEach(btn => btn.onclick = () => showTab(btn.dataset.tab));
    b.querySelector('#bld-phone').onclick = () => { state.phone = !state.phone; b.querySelector('.bld-stage')?.classList.toggle('phone', state.phone); };
    b.querySelector('#bld-restart').onclick = () => reloadPreview();
    b.querySelector('#bld-reset').onclick = resetData;
    showTab('preview');
  }

  function teardownPreview() { if (state.handle) { state.handle.destroy(); state.handle = null; } }

  function showTab(tab) {
    state.tab = tab;
    const b = state.body;
    b.querySelectorAll('.bld-tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
    b.querySelector('#bld-preview-tools').style.display = tab === 'preview' ? '' : 'none';
    const pane = b.querySelector('#bld-pane');
    if (tab !== 'preview') teardownPreview();
    if (tab === 'preview') {
      pane.innerHTML = `<div class="bld-stage ${state.phone ? 'phone' : ''}"><div class="bld-frame" id="bld-frame"></div></div><div id="bld-errs"></div>`;
      reloadPreview();
    } else if (tab === 'files') filesTab(pane); else versionsTab(pane);
  }

  async function refreshProject() {
    if (!state.project) return;
    try { state.project = await api('GET', '/projects/' + state.project.id); } catch (e) { /* keep */ }
  }

  async function reloadPreview() {
    const frame = state.body && state.body.querySelector('#bld-frame');
    if (!frame || !state.project) return;
    const token = ++state.token;
    await refreshProject();
    teardownPreview();
    frame.innerHTML = '';
    state.errors = [];
    drawErrors();
    const has = state.project.files?.some(f => f.path === 'index.html');
    if (!has) { frame.innerHTML = `<div class="bld-placeholder">${esc(t('bld_preview_empty'))}</div>`; return; }
    const user = { name: '' };
    try {
      const hh = localStorage.getItem('apphub_token');
      if (hh) { const r = await fetch('/api/pub/apphub/me', { headers: { 'X-Pub-Token': hh } }); if (r.ok) { const me = await r.json(); user.name = me.display_name || me.username || ''; } }
    } catch (e) { /* anonymous */ }
    if (token !== state.token || !state.body) return;
    try {
      const pid = state.project.id;
      const isGame = state.project.category === 'Games';
      const handle = await BuilderRuntime.mount(frame, {
        appId: state.project.app_id, mode: 'preview', user, serverBase: state.project.installed ? '/api/apps/' + state.project.app_id : '',
        api: { base: `${API}/projects/${pid}/run`, headers: () => (localStorage.getItem('apphub_token') ? { 'X-Pub-Token': localStorage.getItem('apphub_token') } : {}) },
        game: isGame ? { player: { name: user.name || 'Player', avatar_svg: null }, finish: async r => { mvmOS.toast(t('bld_game_finish', { score: r.score })); return { recorded: false }; } } : null,
        onReport: e => {
          if (!state.project || state.project.id !== pid) return;
          if (!state.errors.some(x => x.message === e.message)) state.errors.push(e);
          api('POST', `/projects/${pid}/errors`, e).catch(() => {});
          drawErrors();
        },
      });
      if (token !== state.token) { handle.destroy(); return; }
      state.handle = handle;
    } catch (e) {
      frame.innerHTML = `<div class="bld-placeholder">${esc(e.message || e)}</div>`;
    }
  }

  function drawErrors() {
    const host = state.body && state.body.querySelector('#bld-errs');
    if (!host) return;
    if (!state.errors.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="bld-errbar"><span>⚠ ${esc(t('bld_errors', { n: state.errors.length }))} <span class="bld-muted">${esc(state.errors[0].message.slice(0, 120))}</span></span><button class="bld-btn small primary" id="bld-fix">${esc(t('bld_fix_errors'))}</button></div>`;
    host.querySelector('#bld-fix').onclick = () => send(t('bld_fix_msg') + '\n' + state.errors.slice(0, 3).map(e => '- ' + e.message).join('\n'));
  }

  async function resetData() {
    if (!await mvmOS.confirm(t('bld_reset_confirm'), { ok: t('bld_reset_data'), cancel: t('bld_cancel'), danger: true })) return;
    await api('DELETE', `/projects/${state.project.id}/run/data`).catch(() => {});
    reloadPreview();
  }

  // ── Files and versions ────────────────────────────────────────────────────
  async function filesTab(pane, openPath) {
    await refreshProject();
    const files = state.project.files || [];
    pane.innerHTML = `<div class="bld-list" id="bld-files">${files.length ? files.map(f => `<div class="bld-row"><span class="name">${esc(f.path)} <span class="bld-muted">· ${Math.max(1, Math.round(f.size / 1024))} KB</span></span><span>${/\.(html|css|js|json|svg|txt|md)$/.test(f.path) ? `<button class="bld-btn small" data-edit="${esc(f.path)}">${esc(t('bld_edit'))}</button> ` : ''}<button class="bld-btn small danger" data-rm="${esc(f.path)}">${esc(t('bld_delete'))}</button></span></div>`).join('') : `<div class="bld-muted">${esc(t('bld_files_none'))}</div>`}</div>
      <div class="bld-check" id="bld-check"><button class="bld-btn small" id="bld-validate">${esc(t('bld_validate'))}</button> <span id="bld-valid-out"></span></div>`;
    pane.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editFile(pane, b.dataset.edit));
    pane.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
      if (!await mvmOS.confirm(t('bld_file_delete_confirm', { path: b.dataset.rm }), { ok: t('bld_delete'), cancel: t('bld_cancel'), danger: true })) return;
      await api('DELETE', `/projects/${state.project.id}/file?path=${encodeURIComponent(b.dataset.rm)}`).catch(e => mvmOS.toast(e.message));
      filesTab(pane);
    });
    pane.querySelector('#bld-validate').onclick = runValidate;
    if (openPath) editFile(pane, openPath);
  }

  async function runValidate() {
    const out = state.body.querySelector('#bld-valid-out');
    if (!out) return null;
    out.textContent = '…';
    try {
      const r = await api('GET', `/projects/${state.project.id}/validate`);
      out.innerHTML = r.errors.length || r.warnings.length
        ? `<b>${esc(r.errors.length ? t('bld_valid_errors', { n: r.errors.length }) : t('bld_valid_ok'))}</b>${r.warnings.length ? ' · ' + esc(t('bld_valid_warnings', { n: r.warnings.length })) : ''}<ul>${r.errors.map(e => `<li class="err">${esc(e)}</li>`).join('')}${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`
        : `<b>${esc(t('bld_valid_ok'))}</b>`;
      return r;
    } catch (e) { out.textContent = e.message; return null; }
  }

  async function editFile(pane, path) {
    let data;
    try { data = await api('GET', `/projects/${state.project.id}/file?path=${encodeURIComponent(path)}`); } catch (e) { mvmOS.toast(e.message); return; }
    pane.innerHTML = `<div class="bld-editor"><div class="bld-row"><span class="name">${esc(path)}</span><span><button class="bld-btn small" id="bld-ed-back">${esc(t('bld_back'))}</button> <button class="bld-btn small primary" id="bld-ed-save">${esc(t('bld_save'))}</button></span></div><textarea id="bld-ed-text" spellcheck="false"></textarea></div>`;
    const ta = pane.querySelector('#bld-ed-text');
    ta.value = data.content || '';
    pane.querySelector('#bld-ed-back').onclick = () => filesTab(pane);
    pane.querySelector('#bld-ed-save').onclick = async () => {
      try { await api('PUT', `/projects/${state.project.id}/file`, { path, content: ta.value }); mvmOS.toast(t('bld_saved')); } catch (e) { mvmOS.toast(e.message); }
    };
  }

  async function versionsTab(pane) {
    await refreshProject();
    const snaps = state.project.snapshots || [];
    pane.innerHTML = `<div class="bld-list"><div class="bld-muted">${esc(t('bld_versions_hint'))}</div>${snaps.length ? snaps.map(s => `<div class="bld-row"><span>${esc(s.label || s.id)} <span class="bld-muted">· ${esc(s.id.slice(0, 4) + '-' + s.id.slice(4, 6) + '-' + s.id.slice(6, 8) + ' ' + s.id.slice(9, 11) + ':' + s.id.slice(11, 13))}</span></span><button class="bld-btn small" data-restore="${esc(s.id)}">${esc(t('bld_restore'))}</button></div>`).join('') : `<div class="bld-muted">${esc(t('bld_versions_none'))}</div>`}</div>`;
    pane.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
      if (!await mvmOS.confirm(t('bld_restore_confirm'), { ok: t('bld_restore'), cancel: t('bld_cancel') })) return;
      try { await api('POST', `/projects/${state.project.id}/restore`, { snapshot: b.dataset.restore }); mvmOS.toast(t('bld_restored')); versionsTab(pane); } catch (e) { mvmOS.toast(e.message); }
    });
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  function logEl() { return state.body && state.body.querySelector('#bld-log'); }
  function scrollLog() { const l = logEl(); if (l) l.scrollTop = l.scrollHeight; }

  function msgHTML(m) {
    const ch = (m.changed || []).length ? `<div class="bld-files-changed">${esc(t('bld_files_changed', { n: m.changed.length }))}: ${esc(m.changed.slice(0, 8).join(', '))}</div>` : '';
    return `<div class="bld-msg ${m.role === 'user' ? 'user' : 'ai'}">${esc(m.content)}${m.role === 'user' ? '' : ch}</div>`;
  }
  function renderHistory(msgs) {
    const l = logEl();
    if (!l) return;
    l.innerHTML = msgs.length ? msgs.map(msgHTML).join('') : `<div class="bld-msg ai">${esc(t('bld_welcome'))}</div>`;
    scrollLog();
  }

  function setRunning(on) {
    state.running = on;
    const b = state.body; if (!b) return;
    const send = b.querySelector('#bld-send'), stop = b.querySelector('#bld-stop');
    if (send) send.disabled = on;
    if (stop) stop.style.display = on ? '' : 'none';
    const l = logEl();
    if (l) {
      l.querySelector('.bld-work')?.remove();
      if (on) { const w = document.createElement('div'); w.className = 'bld-work'; w.innerHTML = `<span class="bld-dot"></span>${esc(t('bld_thinking'))}`; l.appendChild(w); scrollLog(); }
    }
  }

  function stepText(ev) {
    const p = ev.path || '';
    const map = { write_file: 'bld_tool_write', edit_file: 'bld_tool_edit', delete_file: 'bld_tool_delete', read_file: 'bld_tool_read', validate: 'bld_tool_validate',
                  set_app_info: 'bld_tool_info', list_integrations: 'bld_tool_integrations', set_integrations: 'bld_tool_integrations', read_guide: 'bld_tool_guide',
                  list_files: 'bld_tool_list', get_runtime_errors: 'bld_tool_errors' };
    const base = t(map[ev.name] || 'bld_tool_other', { path: p, name: ev.name });
    return ev.ok === false && ev.detail ? `${base}: ${ev.detail}` : base;
  }

  async function send(text) {
    const input = state.body && state.body.querySelector('#bld-input');
    const message = (text ?? input?.value ?? '').trim();
    if (!message || state.running || !state.project) return;
    if (input && text === undefined) input.value = '';
    const l = logEl();
    if (l) { l.querySelector('.bld-msg.ai:only-child')?.remove(); l.insertAdjacentHTML('beforeend', msgHTML({ role: 'user', content: message })); }
    setRunning(true);
    try {
      const r = await api('POST', `/projects/${state.project.id}/chat`, { message, lang: window.mvmOS?.lang || 'en' });
      poll(r.turn_id, 0);
    } catch (e) {
      setRunning(false);
      const msg = e.message === 'ai_unavailable' ? t('bld_ai_not_configured') : e.message;
      l?.insertAdjacentHTML('beforeend', `<div class="bld-msg ai">${esc(msg)}</div>`);
      scrollLog();
    }
  }

  function stopPolling() { clearTimeout(state.pollTimer); state.pollTimer = null; }

  function poll(turnId, after) {
    stopPolling();
    const pid = state.project?.id;
    const tick = async () => {
      if (!state.body || state.project?.id !== pid) return;
      let r;
      try { r = await api('GET', `/projects/${pid}/turn/${turnId}?after=${after}`); }
      catch (e) { state.pollTimer = setTimeout(tick, 2500); return; }
      after = r.next;
      const l = logEl();
      let touched = false;
      (r.events || []).forEach(ev => {
        if (!l) return;
        l.querySelector('.bld-work')?.remove();
        if (ev.type === 'tool') {
          let steps = l.querySelector('.bld-steps:last-child');
          if (!steps) { steps = document.createElement('div'); steps.className = 'bld-steps'; l.appendChild(steps); }
          steps.insertAdjacentHTML('beforeend', `<div class="bld-step ${ev.ok === false ? 'bad' : ''}"><span>${ev.ok === false ? '✗' : '✓'}</span><span>${esc(stepText(ev))}</span></div>`);
          if (['write_file', 'edit_file', 'delete_file', 'set_app_info'].includes(ev.name) && ev.ok !== false) touched = true;
        } else if (ev.type === 'text') {
          l.insertAdjacentHTML('beforeend', `<div class="bld-msg ai">${esc(ev.text)}</div>`);
        }
      });
      if (touched) { clearTimeout(state.reloadTimer); state.reloadTimer = setTimeout(() => { if (state.tab === 'preview') reloadPreview(); }, 900); }
      if (!r.done) { if (l && !l.querySelector('.bld-work')) { const w = document.createElement('div'); w.className = 'bld-work'; w.innerHTML = `<span class="bld-dot"></span>${esc(t('bld_thinking'))}`; l.appendChild(w); } scrollLog(); state.pollTimer = setTimeout(tick, 1100); return; }
      setRunning(false);
      if (r.error) l?.insertAdjacentHTML('beforeend', `<div class="bld-msg ai bld-err">${esc(r.error === 'ai_unavailable' ? t('bld_ai_not_configured') : r.error)}</div>`);
      const final = (r.events || []).find(e => e.type === 'done')?.text;
      if (final) l?.insertAdjacentHTML('beforeend', msgHTML({ role: 'assistant', content: final, changed: r.changed }));
      scrollLog();
      await refreshProject();
      const ico = state.body?.querySelector('.bld-top .bld-ico');
      if (ico && state.project) ico.innerHTML = iconHTML(state.project);
      if (state.tab === 'preview') reloadPreview(); else if (state.tab === 'files') filesTab(state.body.querySelector('#bld-pane'));
    };
    tick();
  }

  async function stopTurn() {
    const tid = await api('GET', `/projects/${state.project.id}/chat`).then(r => r.running).catch(() => null);
    if (tid) api('POST', `/projects/${state.project.id}/turn/${tid}/stop`).catch(() => {});
  }

  async function clearChat() {
    if (state.running) return;
    if (!await mvmOS.confirm(t('bld_clear_confirm'), { ok: t('bld_clear_chat'), cancel: t('bld_cancel') })) return;
    await api('DELETE', `/projects/${state.project.id}/chat`).catch(() => {});
    renderHistory([]);
  }

  // ── Settings, install, download ───────────────────────────────────────────
  async function settingsDialog() {
    const p = state.project;
    let integ = { signed_in: false, apps: [] };
    try { integ = await api('GET', '/integrations'); } catch (e) { /* none */ }
    const chosen = new Set(p.integrations || []);
    const known = new Map((integ.apps || []).map(a => [a.id, a]));
    (p.integrations || []).forEach(id => { if (!known.has(id)) known.set(id, { id, name: id, icon: '🧩', gone: true }); });
    const isGame = p.category === 'Games';
    dialog(`<h3>${esc(t('bld_settings_title'))}</h3>
      <div class="bld-field"><label for="bld-s-name">${esc(t('bld_f_name'))}</label><input type="text" id="bld-s-name" maxlength="40" value="${esc(p.name)}"></div>
      <div class="bld-field"><label for="bld-s-cat">${esc(t('bld_f_category'))}</label><select id="bld-s-cat" ${p.installed ? 'title="' + esc(t('bld_cat_locked')) + '"' : ''}>${categoryOptions(p.category)}</select></div>
      <div class="bld-field"><label for="bld-s-emoji">${esc(t('bld_f_emoji'))}</label><input type="text" id="bld-s-emoji" maxlength="8" value="${esc(p.emoji || '')}" style="max-width:120px"></div>
      <div class="bld-field"><label for="bld-s-desc">${esc(t('bld_f_desc'))}</label><textarea id="bld-s-desc" rows="3" maxlength="300">${esc(p.description || '')}</textarea></div>
      <div class="bld-check-row"><input type="checkbox" id="bld-s-prof" ${p.profiles ? 'checked' : ''}><label for="bld-s-prof"><b>${esc(t('bld_f_profiles'))}</b><small>${esc(t('bld_f_profiles_hint'))}</small></label></div>
      <div class="bld-check-row"><input type="checkbox" id="bld-s-pub" ${p.public ? 'checked' : ''} ${isGame ? 'disabled' : ''}><label for="bld-s-pub"><b>${esc(t('bld_f_public'))}</b><small>${esc(isGame ? t('bld_f_game_hint') : t('bld_f_public_hint'))}</small></label></div>
      <div class="bld-field"><label>${esc(t('bld_f_languages'))}</label><div class="bld-langs">${languageBoxes(p.languages || ['en'])}</div></div>
      <div class="bld-field"><label>${esc(t('bld_f_integrations'))}</label>
        ${integ.signed_in ? (known.size ? [...known.values()].map(a => `<div class="bld-check-row"><input type="checkbox" data-int="${esc(a.id)}" id="bld-i-${esc(a.id)}" ${chosen.has(a.id) ? 'checked' : ''}><label for="bld-i-${esc(a.id)}">${esc(a.icon || '🧩')} ${esc(a.name)}${a.gone ? `<small>${esc(t('bld_int_unavailable'))}</small>` : ''}</label></div>`).join('') : `<span class="bld-muted">${esc(t('bld_f_integrations_none'))}</span>`) : `<span class="bld-muted">${esc(t('bld_f_integrations_login'))}</span>`}
      </div>
      <div class="bld-dlg-actions"><button class="bld-btn" data-x>${esc(t('bld_cancel'))}</button><button class="bld-btn primary" data-ok>${esc(t('bld_save'))}</button></div>`,
    (wrap, close) => {
      const $ = s => wrap.querySelector(s);
      $('#bld-s-pub').addEventListener('change', () => { if ($('#bld-s-pub').checked) $('#bld-s-prof').checked = true; });
      $('#bld-s-prof').addEventListener('change', () => { if (!$('#bld-s-prof').checked) $('#bld-s-pub').checked = false; });
      $('[data-x]').onclick = close;
      $('[data-ok]').onclick = async () => {
        const body = { name: $('#bld-s-name').value, category: $('#bld-s-cat').value, emoji: $('#bld-s-emoji').value, description: $('#bld-s-desc').value,
                       profiles: $('#bld-s-prof').checked, public: $('#bld-s-pub').checked };
        body.languages = pickedLanguages(wrap);
        if (!body.languages.length) { mvmOS.toast(t('bld_lang_one')); return; }
        const added = body.languages.filter(l => !(p.languages || []).includes(l));
        if (integ.signed_in) body.integrations = [...wrap.querySelectorAll('[data-int]')].filter(x => x.checked).map(x => x.dataset.int);
        try { await api('PATCH', '/projects/' + p.id, body); close(); await refreshProject(); drawWork(); renderHistory((await api('GET', `/projects/${p.id}/chat`)).messages); reloadPreview(); mvmOS.toast(t('bld_saved'));
          if (added.length && p.files?.some(f => f.path === 'i18n.json')) send(t('bld_add_langs_msg', { langs: added.map(l => LANG_NAMES[l] || l).join(', ') })); }
        catch (e) { mvmOS.toast(e.message); }
      };
    });
  }

  async function download() {
    try {
      const r = await fetch(`${API}/projects/${state.project.id}/export`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'HTTP ' + r.status);
      const blob = await r.blob();
      const name = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || (state.project.app_id + '.zip');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { mvmOS.toast(e.message); }
  }

  async function installFlow() {
    if (state.running) { mvmOS.toast(t('bld_wait_ai')); return; }
    await refreshProject();
    const p = state.project;
    await refreshProject();
    const r = await api('GET', `/projects/${p.id}/validate`).catch(e => ({ errors: [e.message], warnings: [] }));
    if (r.errors.length) {
      dialog(`<h3>${esc(t('bld_problems'))}</h3><ul>${r.errors.slice(0, 8).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
        <div class="bld-dlg-actions"><button class="bld-btn" data-x>${esc(t('bld_close'))}</button><button class="bld-btn primary" data-fix>${esc(t('bld_fix_errors'))}</button></div>`,
      (wrap, close) => {
        wrap.querySelector('[data-x]').onclick = close;
        wrap.querySelector('[data-fix]').onclick = () => { close(); send(t('bld_fix_msg') + '\n' + r.errors.slice(0, 6).map(e => '- ' + e).join('\n')); };
      });
      return;
    }
    const names = (p.integrations || []).join(', ');
    dialog(`<h3>${esc(t('bld_install_title', { name: p.name }))}</h3>
      <p style="margin:0">${esc(t('bld_install_body'))}</p>
      ${p.imported ? `<p class="bld-banner warn" style="margin:0">${esc(t('bld_install_imported'))}</p>` : ''}
      ${names ? `<p style="margin:0">${esc(t('bld_install_integrations', { apps: names }))}</p>` : ''}
      ${p.category === 'Games' ? `<p style="margin:0">${esc(t('bld_install_game'))}</p>` : ''}
      ${(p.server_files || []).length ? `<p class="bld-banner warn" style="margin:0">${esc(t('bld_install_server', { files: p.server_files.join(', ') }))}</p>` : ''}
      ${p.public ? `<p style="margin:0">${esc(t('bld_install_public'))}</p>` : ''}
      <div class="bld-dlg-actions"><button class="bld-btn" data-x>${esc(t('bld_cancel'))}</button><button class="bld-btn primary" data-ok>${esc(p.installed ? t('bld_update') : t('bld_install'))}</button></div>`,
    (wrap, close) => {
      wrap.querySelector('[data-x]').onclick = close;
      wrap.querySelector('[data-ok]').onclick = async ev => {
        ev.target.disabled = true; ev.target.textContent = t('bld_installing');
        try {
          const res = await api('POST', `/projects/${p.id}/install`, { confirm_server: (p.server_files || []).length > 0 });
          const wasOpen = Array.from(document.querySelectorAll('.window')).some(w => w.dataset.winId === res.app_id);
          await mvmOS._refreshPlugins();
          await mvmOS._loadPlugin(res.app_id);
          if (wasOpen) Desktop.reloadApp?.(res.app_id);
          close();
          await refreshProject();
          drawWork();
          renderHistory((await api('GET', `/projects/${p.id}/chat`)).messages);
          showTab(state.tab);
          mvmOS.toast(t('bld_installed_ok', { name: p.name }));
        } catch (e) { close(); mvmOS.toast(t('bld_install_failed'), e.message); }
      };
    });
  }

  async function uninstallFlow() {
    const p = state.project;
    if (!await mvmOS.confirm(t('bld_uninstall_confirm', { name: p.name }), { ok: t('bld_uninstall'), cancel: t('bld_cancel'), danger: true })) return;
    try {
      await api('POST', `/projects/${p.id}/uninstall`);
      mvmOS._removeFromStartMenu?.(p.app_id);
      Desktop.removeApp?.(p.app_id);
      await mvmOS._refreshPlugins?.();
      await refreshProject();
      drawWork();
      renderHistory((await api('GET', `/projects/${p.id}/chat`)).messages);
      showTab(state.tab);
    } catch (e) { mvmOS.toast(e.message); }
  }

  return { openWindow };
})();
