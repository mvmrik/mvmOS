// External API tokens — one list and editor shared by the desktop (the
// owner's tokens for core apps, in Settings) and the Apps Hub public page (a
// profile's tokens for store apps, in its Settings). The server decides which
// apps and functions may be chosen; this only draws them.
//
// A token is shown once, right after it is made. Afterwards only its first
// characters are known, so it can be renamed, have its rights changed, or be
// deleted — a lost one is replaced by making a new one.

window.ExtApiTokens = (() => {
  const tr = (key, vars) => (window.t ? window.t(key, vars) : key);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const C = {
    surface: 'var(--surface, var(--surface1))',
    surface2: 'var(--surface2)',
    text: 'var(--text, var(--fg))',
    dim: 'var(--text-dim, var(--fg2))',
  };
  const btn = (primary, danger) =>
    `border-radius:6px;padding:6px 12px;font-size:.8rem;font-weight:600;cursor:pointer;border:1px solid ${danger ? '#e05555' : primary ? 'transparent' : 'var(--border)'};` +
    `background:${danger ? '#e05555' : primary ? 'var(--accent)' : C.surface2};color:${danger ? '#fff' : primary ? '#1e1e2e' : C.text}`;

  function fmtDate(iso) {
    if (!iso) return tr('extapi_never');
    try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return iso; }
  }

  function overlay(html) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = `<div style="background:${C.surface};color:${C.text};border:1px solid var(--border);border-radius:10px;padding:20px;width:560px;max-width:100%;max-height:90vh;display:flex;flex-direction:column;gap:12px;box-sizing:border-box">${html}</div>`;
    document.body.appendChild(ov);
    return ov;
  }

  function mount(container, opts) {
    const base = opts.base;
    const headers = () => ({ 'Content-Type': 'application/json', ...(opts.headers ? opts.headers() : {}) });
    const api = async (path, method = 'GET', body) => {
      const res = await fetch(base + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data.detail;
        throw new Error(typeof d === 'string' && d.startsWith('extapi_') ? tr(d) : tr('extapi_error_generic'));
      }
      return data;
    };
    const endpoint = location.origin + '/pub/api/v1';

    async function draw() {
      container.innerHTML = `<div style="color:${C.dim};font-size:.85rem">${esc(tr('loading'))}</div>`;
      let state;
      try { state = await api('/tokens'); }
      catch (e) { container.innerHTML = `<div style="color:#e05555;font-size:.85rem">${esc(e.message)}</div>`; return; }
      const apps = state.apps || [];
      const names = Object.fromEntries(apps.map(a => [a.id, a]));
      const rows = (state.tokens || []).map(tk => {
        const scope = Object.entries(tk.scopes || {}).map(([id, fns]) =>
          `${esc(names[id]?.icon || '')} ${esc(names[id]?.name || id)} <span style="color:${C.dim}">(${fns.length})</span>`).join(', ');
        return `
          <div style="display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:${C.surface2}">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:.88rem;word-break:break-word">🔑 ${esc(tk.name)}</div>
              <div style="font:.74rem monospace;color:${C.dim};margin-top:3px">${esc(tk.prefix)}…</div>
              <div style="font-size:.78rem;margin-top:5px;line-height:1.5">${scope || `<span style="color:${C.dim}">${esc(tr('extapi_token_no_rights'))}</span>`}</div>
              <div style="font-size:.74rem;color:${C.dim};margin-top:4px">${esc(tr('extapi_token_created'))}: ${esc(fmtDate(tk.created_at))} · ${esc(tr('extapi_token_last_used'))}: ${esc(fmtDate(tk.last_used_at))}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">
              <button data-edit="${tk.id}" style="${btn()}">${esc(tr('extapi_token_edit'))}</button>
              <button data-del="${tk.id}" style="${btn(false, true)}">${esc(tr('extapi_token_delete'))}</button>
            </div>
          </div>`;
      }).join('');
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="font-size:.82rem;color:${C.dim};line-height:1.5">${esc(tr('extapi_tokens_desc'))}</div>
          <div style="font-size:.8rem;line-height:1.5">${esc(tr('extapi_endpoint'))}: <code style="user-select:all;word-break:break-all">${esc(endpoint)}</code></div>
          <div style="font-size:.78rem;color:${C.dim};line-height:1.5">${esc(tr('extapi_endpoint_help'))}</div>
          ${apps.length ? '' : `<div style="font-size:.82rem;color:${C.dim}">${esc(tr(opts.noAppsKey || 'extapi_no_apps'))}</div>`}
          <div style="display:flex;flex-direction:column;gap:8px">${rows || `<div style="font-size:.82rem;color:${C.dim}">${esc(tr('extapi_no_tokens'))}</div>`}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button data-new style="${btn(true)}" ${apps.length ? '' : 'disabled'}>${esc(tr('extapi_token_new'))}</button>
            <button data-docs style="${btn()}" ${apps.length ? '' : 'disabled'}>📖 ${esc(tr('extapi_docs_btn'))}</button>
          </div>
        </div>`;
      container.querySelector('[data-new]').onclick = () => editor(apps, null);
      container.querySelector('[data-docs]').onclick = () => docs(apps);
      container.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
        editor(apps, state.tokens.find(x => x.id === +b.dataset.edit)));
      container.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        const tk = state.tokens.find(x => x.id === +b.dataset.del);
        const ok = window.mvmOS?.confirm ? await window.mvmOS.confirm(tr('extapi_token_delete_confirm', { name: tk.name }))
                                         : confirm(tr('extapi_token_delete_confirm', { name: tk.name }));
        if (!ok) return;
        try { await api('/tokens/' + tk.id, 'DELETE'); } catch (e) { alert(e.message); }
        draw();
      });
    }

    // The editor takes the place of the list rather than opening over it: one
    // compact row per app, so a server with hundreds of apps stays readable.
    // Checking an app gives it the chosen level (everything or read only); the
    // functions of one app are picked only when asked, in a dialog of its own.
    function editor(apps, token) {
      const picked = {};       // app id -> Set of function names
      for (const [id, fns] of Object.entries(token?.scopes || {})) picked[id] = new Set(fns);
      const byId = Object.fromEntries(apps.map(a => [a.id, a]));
      const readOf = a => a.functions.filter(f => f.access === 'read').map(f => f.name);
      const allOf = a => a.functions.map(f => f.name);
      let level = 'all';
      const levelFns = a => level === 'read' ? readOf(a) : allOf(a);

      container.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px">
          <div style="font-weight:700">${esc(tr(token ? 'extapi_token_edit_title' : 'extapi_token_new_title'))}</div>
          <input data-name maxlength="80" placeholder="${esc(tr('extapi_token_name_placeholder'))}" value="${esc(token?.name || '')}"
            style="background:${C.surface2};border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:${C.text};font-size:.88rem;width:100%;box-sizing:border-box">
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <span style="font-size:.8rem;color:${C.dim}">${esc(tr('extapi_level_label'))}</span>
            <button data-level="all" style="${btn()}">${esc(tr('extapi_level_full'))}</button>
            <button data-level="read" style="${btn()}">${esc(tr('extapi_level_read'))}</button>
            <span style="flex:1"></span>
            <button data-sel="all" style="${btn()}">${esc(tr('extapi_select_all'))}</button>
            <button data-sel="none" style="${btn()}">${esc(tr('extapi_select_none'))}</button>
          </div>
          ${apps.length > 8 ? `<input data-search placeholder="${esc(tr('extapi_search_apps'))}"
            style="background:${C.surface2};border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:${C.text};font-size:.84rem;width:100%;box-sizing:border-box">` : ''}
          <div data-apps style="display:flex;flex-direction:column;gap:4px"></div>
          <div data-err style="color:#e05555;font-size:.8rem" hidden></div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button data-cancel style="${btn()}">${esc(tr('cancel'))}</button>
            <button data-save style="${btn(true)}">${esc(tr(token ? 'save' : 'extapi_token_create'))}</button>
          </div>
        </div>`;
      const list = container.querySelector('[data-apps]');
      const search = container.querySelector('[data-search]');

      const status = a => {
        const set = picked[a.id];
        if (!set || !set.size) return '';
        if (set.size === a.functions.length) return tr('extapi_level_full');
        const reads = readOf(a);
        if (set.size === reads.length && reads.every(n => set.has(n))) return tr('extapi_level_read');
        return tr('extapi_level_custom', { n: set.size, total: a.functions.length });
      };
      const paintLevel = () => container.querySelectorAll('[data-level]').forEach(b => {
        b.style.cssText = btn(b.dataset.level === level);
      });
      const drawApps = () => {
        const q = (search?.value || '').trim().toLowerCase();
        list.innerHTML = apps.filter(a => !q || a.name.toLowerCase().includes(q) || a.id.includes(q)).map(a => {
          const on = !!picked[a.id]?.size;
          return `
            <div data-app="${esc(a.id)}" style="display:flex;gap:10px;align-items:center;padding:6px 10px;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};border-radius:8px;background:${C.surface2}">
              <label style="display:flex;gap:8px;align-items:center;flex:1;min-width:0;cursor:pointer;font-size:.86rem">
                <input type="checkbox" data-check ${on ? 'checked' : ''}>
                <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.icon)} ${esc(a.name)}</span>
              </label>
              <span style="font-size:.74rem;color:${C.dim};white-space:nowrap">${esc(status(a))}</span>
              <button data-fns style="${btn()};padding:3px 9px;font-size:.74rem">${esc(tr('extapi_functions_btn'))}</button>
            </div>`;
        }).join('');
        list.querySelectorAll('[data-app]').forEach(row => {
          const a = byId[row.dataset.app];
          row.querySelector('[data-check]').onchange = e => {
            if (!e.target.checked) { delete picked[a.id]; drawApps(); return; }
            const fns = levelFns(a);
            // An app with nothing to read cannot be given read-only access,
            // so its functions are picked by hand instead.
            if (!fns.length) { e.target.checked = false; pickFunctions(a); return; }
            picked[a.id] = new Set(fns);
            drawApps();
          };
          row.querySelector('[data-fns]').onclick = () => pickFunctions(a);
        });
      };

      const pickFunctions = a => {
        const set = picked[a.id] || new Set();
        const ov = overlay(`
          <div style="font-weight:700">${esc(a.icon)} ${esc(a.name)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button data-sel="all" style="${btn()}">${esc(tr('extapi_select_all'))}</button>
            <button data-sel="read" style="${btn()}">${esc(tr('extapi_level_read'))}</button>
            <button data-sel="none" style="${btn()}">${esc(tr('extapi_select_none'))}</button>
          </div>
          <div style="overflow:auto;display:flex;flex-direction:column;gap:6px;min-height:0">${a.functions.map(f => `
            <label style="display:flex;gap:8px;align-items:flex-start;font-size:.8rem;cursor:pointer;line-height:1.4">
              <input type="checkbox" data-fn="${esc(f.name)}" data-access="${esc(f.access)}" ${set.has(f.name) ? 'checked' : ''} style="margin-top:2px">
              <span style="min-width:0"><code>${esc(f.name)}</code>
                <span style="font-size:.7rem;padding:0 5px;border-radius:4px;border:1px solid var(--border);color:${f.access === 'read' ? '#55b971' : '#e0a040'}">${esc(tr(f.access === 'read' ? 'extapi_access_read' : 'extapi_access_write'))}</span>
                ${f.summary ? `<span style="display:block;color:${C.dim}">${esc(f.summary)}</span>` : ''}</span>
            </label>`).join('')}
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button data-cancel style="${btn()}">${esc(tr('cancel'))}</button>
            <button data-ok style="${btn(true)}">${esc(tr('ok'))}</button>
          </div>`);
        ov.querySelectorAll('[data-sel]').forEach(b => b.onclick = () =>
          ov.querySelectorAll('[data-fn]').forEach(x => {
            x.checked = b.dataset.sel === 'all' || (b.dataset.sel === 'read' && x.dataset.access === 'read');
          }));
        ov.querySelector('[data-cancel]').onclick = () => ov.remove();
        ov.querySelector('[data-ok]').onclick = () => {
          const fns = [...ov.querySelectorAll('[data-fn]:checked')].map(x => x.dataset.fn);
          if (fns.length) picked[a.id] = new Set(fns); else delete picked[a.id];
          ov.remove();
          drawApps();
        };
      };

      container.querySelectorAll('[data-level]').forEach(b => b.onclick = () => {
        level = b.dataset.level;
        for (const id of Object.keys(picked)) {
          const fns = levelFns(byId[id]);
          if (fns.length) picked[id] = new Set(fns); else delete picked[id];
        }
        paintLevel(); drawApps();
      });
      container.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => {
        for (const a of apps) {
          if (b.dataset.sel === 'none') { delete picked[a.id]; continue; }
          const fns = levelFns(a);
          if (fns.length) picked[a.id] = new Set(fns);
        }
        drawApps();
      });
      if (search) search.oninput = drawApps;
      paintLevel(); drawApps();

      container.querySelector('[data-cancel]').onclick = () => draw();
      container.querySelector('[data-save]').onclick = async () => {
        const err = container.querySelector('[data-err]');
        const name = container.querySelector('[data-name]').value.trim();
        const scopes = {};
        for (const [id, set] of Object.entries(picked)) if (set.size && byId[id]) scopes[id] = [...set];
        const fail = msg => { err.textContent = msg; err.hidden = false; };
        if (!name) return fail(tr('extapi_error_name'));
        if (!Object.keys(scopes).length) return fail(tr('extapi_error_scopes'));
        try {
          if (token) {
            await api('/tokens/' + token.id, 'PUT', { name, scopes });
          } else {
            const made = await api('/tokens', 'POST', { name, scopes });
            showOnce(made.token);
          }
          draw();
        } catch (e) { fail(e.message); }
      };
      container.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }

    // How to call each function the owner of these tokens may be given: the
    // address, the parameters and a ready example. Drawn from the same list
    // the server enforces, so it never shows something that would be refused.
    function docs(apps) {
      const sample = p => ({ int: 1, float: 1.5, bool: true, list: [], dict: {} })[p.type] ?? 'text';
      const example = (a, f) => {
        const url = `${endpoint}/${a.id}/${f.name}`;
        const auth = `  -H "Authorization: Bearer mvmapi_..."`;
        if (f.files) {
          const parts = f.params.filter(p => !p.optional || p.type === 'file').map(p =>
            p.type === 'file' ? `  -F ${p.name}=@/path/to/file` : `  -F ${p.name}=${JSON.stringify(String(sample(p)))}`);
          return [`curl -X POST ${url}`, auth, ...parts].join(' \\\n');
        }
        const body = Object.fromEntries(f.params.filter(p => !p.optional).map(p => [p.name, sample(p)]));
        return [`curl -X POST ${url}`, auth, `  -H "Content-Type: application/json"`,
                `  -d '${JSON.stringify(body)}'`].join(' \\\n');
      };
      const fnHtml = (a, f) => `
        <div style="border-top:1px solid var(--border);padding:10px 0;display:flex;flex-direction:column;gap:6px">
          <div style="font-size:.84rem"><code style="font-weight:700">${esc(f.name)}</code>
            <span style="font-size:.7rem;padding:0 5px;border-radius:4px;border:1px solid var(--border);color:${f.access === 'read' ? '#55b971' : '#e0a040'}">${esc(tr(f.access === 'read' ? 'extapi_access_read' : 'extapi_access_write'))}</span></div>
          ${f.description ? `<div style="font-size:.8rem;color:${C.dim};line-height:1.5;white-space:pre-line">${esc(f.description.replace(/([^\n])\n(?!\n)/g, '$1 '))}</div>` : ''}
          <div style="font-size:.78rem"><span style="color:${C.dim}">POST</span> <code style="user-select:all;word-break:break-all">${esc(`${endpoint}/${a.id}/${f.name}`)}</code></div>
          <div style="font-size:.78rem;line-height:1.6">${f.params.length ? f.params.map(p => `
            <div><code>${esc(p.name)}</code> <span style="color:${C.dim}">${esc(p.type || 'str')} · ${esc(tr(p.optional ? 'extapi_docs_optional' : 'extapi_docs_required'))}</span></div>`).join('')
            : `<span style="color:${C.dim}">${esc(tr('extapi_docs_no_params'))}</span>`}</div>
          <pre style="margin:0;padding:8px 10px;border-radius:6px;background:${C.surface2};border:1px solid var(--border);font-size:.74rem;white-space:pre-wrap;overflow-wrap:anywhere;user-select:all">${esc(example(a, f))}</pre>
        </div>`;
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <button data-back style="${btn()}">← ${esc(tr('extapi_docs_back'))}</button>
            <div style="font-weight:700">${esc(tr('extapi_docs_title'))}</div>
          </div>
          <div style="font-size:.8rem;color:${C.dim};line-height:1.6;white-space:pre-line">${esc(tr('extapi_docs_intro', { url: endpoint }))}</div>
          ${apps.length > 8 ? `<input data-search placeholder="${esc(tr('extapi_search_apps'))}"
            style="background:${C.surface2};border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:${C.text};font-size:.84rem;width:100%;box-sizing:border-box">` : ''}
          <div data-apps style="display:flex;flex-direction:column;gap:4px"></div>
        </div>`;
      const list = container.querySelector('[data-apps]');
      const search = container.querySelector('[data-search]');
      const open = new Set();
      const drawApps = () => {
        const q = (search?.value || '').trim().toLowerCase();
        list.innerHTML = apps.filter(a => !q || a.name.toLowerCase().includes(q) || a.id.includes(q)).map(a => `
          <div data-app="${esc(a.id)}" style="border:1px solid var(--border);border-radius:8px;background:${C.surface};padding:0 10px">
            <div data-toggle style="display:flex;gap:8px;align-items:center;padding:8px 0;cursor:pointer;font-size:.86rem">
              <span style="width:12px">${open.has(a.id) ? '▾' : '▸'}</span>
              <span style="flex:1">${esc(a.icon)} ${esc(a.name)} <code style="color:${C.dim};font-size:.74rem">${esc(a.id)}</code></span>
              <span style="font-size:.74rem;color:${C.dim}">${esc(tr('extapi_functions_count', { n: a.functions.length }))}</span>
            </div>
            ${open.has(a.id) ? a.functions.map(f => fnHtml(a, f)).join('') : ''}
          </div>`).join('');
        list.querySelectorAll('[data-toggle]').forEach(h => h.onclick = () => {
          const id = h.parentElement.dataset.app;
          open.has(id) ? open.delete(id) : open.add(id);
          drawApps();
        });
      };
      if (search) search.oninput = drawApps;
      drawApps();
      container.querySelector('[data-back]').onclick = () => draw();
      container.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }

    function showOnce(value) {
      const ov = overlay(`
        <div style="font-weight:700">${esc(tr('extapi_token_created_title'))}</div>
        <div style="font-size:.84rem;line-height:1.5;color:#e0a040">${esc(tr('extapi_token_once'))}</div>
        <input data-token readonly value="${esc(value)}"
          style="font-family:monospace;background:${C.surface2};border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:${C.text};font-size:.82rem;width:100%;box-sizing:border-box">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button data-copy style="${btn()}">${esc(tr('extapi_copy'))}</button>
          <button data-done style="${btn(true)}">${esc(tr('extapi_token_saved_it'))}</button>
        </div>`);
      const input = ov.querySelector('[data-token]');
      input.focus(); input.select();
      ov.querySelector('[data-copy]').onclick = async e => {
        try { await navigator.clipboard.writeText(value); } catch (_) { input.select(); document.execCommand('copy'); }
        e.target.textContent = tr('extapi_copied');
      };
      ov.querySelector('[data-done]').onclick = () => ov.remove();
    }

    draw();
    return { refresh: draw };
  }

  return { mount };
})();
