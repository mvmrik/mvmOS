// ── Forum — mvmOS ────────────────────────────────────────────────────────────
// Talk with other people who run mvmOS. Everything is written and read here;
// the same posts are shown to everybody, read-only, on mvmos.org/forum. Nobody
// has an account: the server is known by its installation and each person here
// picks a nickname. What you follow (threads you started, answered or watch)
// stays on this server and raises ordinary notifications when someone replies.
//
// Only administrators use it: the server answers 403 admin_only to anyone else.

const ForumApp = (() => {

  const WIN_ID = 'forum';
  const t = (k, v) => (window.t ? window.t(k, v) : k);
  const esc = value => String(value ?? '').replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let _body = null;
  let _nick = null;           // '' = chosen nothing yet, null = not asked yet
  let _view = null;           // what the main area shows, to refresh it
  let _kind = '';             // 'cats' | 'threads' | 'latest' | other: only lists refresh by themselves
  let _appended = false;      // a list that was extended with "load more" is left alone
  let _timer = null;
  let _catLast = {};          // category id → newest post id (and its sub-categories')
  let _catKids = {};          // category id → ids of its sub-categories
  const PULSE_EVERY = 3 * 60 * 1000;   // while the window is open and visible; never when closed
  const $ = s => _body && _body.querySelector(s);

  // ── Talking to the server ────────────────────────────────────────────────
  async function api(path, opts = {}) {
    try {
      const res = await fetch('/api/forum' + path, {
        method: opts.method || 'GET',
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data, error: data && data.detail };
    } catch (_) {
      return { ok: false, status: 0, data: {}, error: 'site_unreachable' };
    }
  }

  function errorText(error) {
    const map = {
      admin_only: 'frm_err_admin_only', site_unreachable: 'frm_err_site', nick_invalid: 'frm_err_nick_invalid',
      nick_taken: 'frm_err_nick_taken', too_many: 'frm_err_too_many', too_fast: 'frm_err_too_fast',
      title_short: 'frm_err_short', body_short: 'frm_err_short', title_long: 'frm_err_long', body_long: 'frm_err_long',
      thread_locked: 'frm_err_locked', thread_closed: 'frm_err_closed', subject_invalid: 'frm_err_subject', category_invalid: 'frm_err_category',
      lang_invalid: 'frm_err_generic', banned: 'frm_err_banned',
    };
    return t(map[error] || 'frm_err_generic');
  }

  const when = value => {
    // The site stores UTC as "YYYY-MM-DD HH:MM:SS"; show it in the person's own time.
    const d = new Date(String(value || '').replace(' ', 'T') + 'Z');
    return isNaN(d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  };

  // ── Categories, languages, chips ─────────────────────────────────────────
  const LANGS = { en: 'English', bg: 'Български', de: 'Deutsch', es: 'Español', fr: 'Français', ja: '日本語',
                  'pt-BR': 'Português (Brasil)', ru: 'Русский', 'zh-CN': '简体中文' };
  const SUBS = ['problems', 'suggestions', 'questions'];

  function catName(slug, name) {
    const suffix = String(slug).split('-').pop();
    const key = slug.includes('-') && SUBS.includes(suffix) ? 'frm_sub_' + suffix : 'frm_cat_' + slug;
    const text = t(key);
    return text && text !== key ? text : (name || slug);
  }
  const catPath = th => th.parent_slug
    ? `${catName(th.parent_slug, th.parent_name)} › ${catName(th.category_slug, th.category_name)}`
    : catName(th.category_slug || '', th.category_name);

  // The language of the forum: the person's own (follows mvmOS), every language, or one
  // picked here. It is remembered in this browser and only affects the forum.
  const LANG_KEY = 'mvmos_forum_lang';
  const getLang = () => { try { return localStorage.getItem(LANG_KEY) || 'auto'; } catch (_) { return 'auto'; } };
  const setLang = v => { try { localStorage.setItem(LANG_KEY, v); } catch (_) {} };
  function langParam() {
    const v = getLang();
    if (v === 'all') return '';
    return v === 'auto' ? (window.mvmOS?.lang || 'en') : v;
  }
  const ownLang = () => (LANGS[window.mvmOS?.lang] ? window.mvmOS.lang : 'en');

  const chips = x => [
    x.subject_name ? `<span class="fm-chip fm-chip-about">${esc(x.subject_name)}</span>` : '',
    x.lang ? `<span class="fm-chip">${esc(String(x.lang).toUpperCase())}</span>` : '',
    x.guest ? `<span class="fm-chip">${esc(t('frm_guest'))}</span>` : '',
    x.staff ? `<span class="fm-chip">${esc(t('frm_team'))}</span>` : '',
  ].join('');

  // What was already seen is only a matter of this browser: the newest post id per thread and
  // category, and a starting line so that what was there before the first visit is not "new".
  const SEEN_KEY = 'mvmos_forum_seen';
  const seen = (() => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch (_) { return {}; } })();
  seen.cats ||= {}; seen.threads ||= {};
  const saveSeen = () => {
    const keys = Object.keys(seen.threads);
    if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(k => delete seen.threads[k]);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (_) {}
  };
  const isNewThread = th => (th.last_post_id || 0) > Math.max(seen.base || 0, seen.threads[th.id] || 0);
  const isNewCat = c => (c.last_post_id || 0) > Math.max(seen.base || 0, seen.cats[c.id] || 0);
  const dot = '<span class="fm-dot" title=""></span>';

  // Plain text, web addresses become links — never markup.
  function textHtml(value) {
    return esc(value).replace(/(https?:\/\/[^\s<>&"']+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\n/g, '<br>');
  }

  // ── Frame ────────────────────────────────────────────────────────────────
  function frame() {
    _body.style.cssText = 'padding:0';
    _body.innerHTML = `
      <div class="fm-root">
        <div class="fm-bar">
          <button class="s-btn s-btn-sm fm-tab" data-tab="cats">${esc(t('frm_tab_cats'))}</button>
          <button class="s-btn s-btn-sm fm-tab" data-tab="latest">${esc(t('frm_tab_latest'))}</button>
          <button class="s-btn s-btn-sm fm-tab" data-tab="mine">${esc(t('frm_tab_mine'))}</button>
          <button class="s-btn s-btn-sm fm-tab" data-tab="watching">🔔 ${esc(t('frm_tab_watching'))}</button>
          <span class="fm-grow"></span>
          <select class="s-input fm-lang" id="fm-lang" title="${esc(t('frm_filter_lang'))}">
            <option value="auto">🌐 ${esc(t('frm_lang_auto'))}</option>
            <option value="all">🌐 ${esc(t('frm_lang_all'))}</option>
            ${Object.entries(LANGS).map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('')}
          </select>
          <button class="s-btn s-btn-sm" id="fm-nick"></button>
          <button class="s-btn s-btn-sm s-btn-primary" id="fm-new">✎ ${esc(t('frm_new_thread'))}</button>
        </div>
        <div class="fm-main" id="fm-main"></div>
      </div>`;
    _body.querySelectorAll('.fm-tab').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
    $('#fm-new').addEventListener('click', () => viewNewThread());
    $('#fm-nick').addEventListener('click', () => askNick());
    const sel = $('#fm-lang');
    sel.value = getLang();
    sel.addEventListener('change', () => { setLang(sel.value); if (_view && _view !== viewNewThread) _view(); });
  }

  function setActive(tab) {
    _body.querySelectorAll('.fm-tab').forEach(b => b.classList.toggle('fm-on', b.dataset.tab === tab));
  }

  function showNick() {
    const b = $('#fm-nick');
    if (b) b.textContent = _nick ? `👤 ${_nick}` : `👤 ${t('frm_nick_choose')}`;
  }

  function main(html) { const m = $('#fm-main'); m.innerHTML = html; m.scrollTop = 0; return m; }
  const loading = () => main(`<div class="fm-note">${esc(t('frm_loading'))}</div>`);
  const fail = res => main(`<div class="fm-note fm-bad">${esc(errorText(res.error))}</div>`);

  function go(tab) {
    setActive(tab);
    if (tab === 'cats') return viewCategories();
    if (tab === 'latest') return viewLatest();
    if (tab === 'mine') return viewThreads({ mine: 1 }, t('frm_tab_mine'));
    if (tab === 'watching') return viewWatching();
  }

  // ── Nickname ─────────────────────────────────────────────────────────────
  // Resolves with the nickname, or '' when the person gave up.
  function askNick() {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.className = 'fm-modal';
      box.innerHTML = `
        <form class="fm-modal-card">
          <h3>${esc(t('frm_nick_title'))}</h3>
          <p>${esc(t('frm_nick_hint'))}</p>
          <input class="s-input" name="nick" maxlength="24" value="${esc(_nick || '')}" autocomplete="off">
          <div class="fm-bad" id="fm-nick-err"></div>
          <div class="fm-row-end">
            <button type="button" class="s-btn s-btn-sm" data-cancel>${esc(t('frm_cancel'))}</button>
            <button type="submit" class="s-btn s-btn-sm s-btn-primary">${esc(t('frm_save'))}</button>
          </div>
        </form>`;
      _body.querySelector('.fm-root').appendChild(box);
      const form = box.querySelector('form');
      const done = value => { box.remove(); resolve(value); };
      box.querySelector('[data-cancel]').addEventListener('click', () => done(''));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const res = await api('/me', { method: 'PUT', body: { nick: form.nick.value } });
        if (!res.ok) { box.querySelector('#fm-nick-err').textContent = errorText(res.error); return; }
        _nick = res.data.nick;
        showNick();
        done(_nick);
      });
      form.nick.focus();
    });
  }

  // Runs a write; if the site wants a nickname first, asks for it and tries once more.
  async function write(call) {
    let res = await call();
    if (!res.ok && res.error === 'nick_required') {
      if (!await askNick()) return res;
      res = await call();
    }
    return res;
  }

  let _cats = null;
  function rememberCats(cats) {
    _cats = cats; _catLast = {}; _catKids = {};
    cats.forEach(c => {
      _catLast[c.id] = c.last_post_id || 0; _catKids[c.id] = (c.children || []).map(k => k.id);
      (c.children || []).forEach(k => { _catLast[k.id] = k.last_post_id || 0; });
    });
    paintTabDot();
  }
  // Opening a category's list is what makes what is in it "seen" (with its sub-categories').
  function markCategorySeen(id) {
    [Number(id), ...(_catKids[id] || [])].forEach(i => { if (_catLast[i]) seen.cats[i] = _catLast[i]; });
    saveSeen(); paintTabDot();
  }
  function paintTabDot() {
    const tab = _body && _body.querySelector('.fm-tab[data-tab="cats"]');
    if (!tab) return;
    const fresh = (_cats || []).some(c => isNewCat(c));
    tab.classList.toggle('fm-has-new', fresh);
  }

  // While the window is open (and the tab visible) it asks every few minutes what is new, so the
  // dots show where; followed threads raise their notifications through the same ask.
  async function pulse() {
    if (!_body || document.hidden || !_body.isConnected) return;
    const res = await api('/pulse?lang=' + encodeURIComponent(langParam()));
    if (!res.ok || !_body) return;
    rememberCats(res.data.categories || []);
    if (_appended || !['cats', 'latest', 'threads'].includes(_kind)) return;
    const m = $('#fm-main'); const top = m ? m.scrollTop : 0;
    await _view?.();
    if (m) m.scrollTop = top;
  }

  // ── Views ────────────────────────────────────────────────────────────────
  async function viewCategories() {
    const wasCats = _kind === 'cats';
    _view = viewCategories; _kind = 'cats'; _appended = false; if (!_cats || !wasCats) loading();
    const res = await api('/categories?lang=' + encodeURIComponent(langParam()));
    if (!res.ok) return fail(res);
    const cats = res.data.categories || [];
    rememberCats(cats);
    const row = (c, sub) => `
      <button class="fm-item${sub ? ' fm-sub' : ' fm-top'}" data-id="${c.id}" data-name="${esc(catName(c.slug, c.name))}">
        <span class="fm-item-main"><b>${esc(catName(c.slug, c.name))}${isNewCat(c) ? dot : ''}</b></span>
        <span class="fm-stat"><b>${c.thread_count}</b>${esc(t('frm_threads'))}</span>
        <span class="fm-stat"><b>${c.post_count}</b>${esc(t('frm_posts'))}</span>
      </button>`;
    const m = main(`<div class="fm-list">${cats.map(c =>
      row(c, false) + (c.children || []).map(k => row(k, true)).join('')).join('')
      || `<div class="fm-note">${esc(t('frm_empty'))}</div>`}</div>`);
    m.querySelectorAll('.fm-item').forEach(b => b.addEventListener('click',
      () => viewThreads({ category: b.dataset.id }, b.dataset.name)));
  }

  async function viewThreads(params, title, offset = 0, append = null) {
    _view = () => viewThreads(params, title); _kind = 'threads'; _appended = !!append;
    if (params.category && !append) markCategorySeen(params.category);
    if (!append) loading();
    const q = new URLSearchParams({ ...params, offset, lang: langParam(), names: ownLang() }).toString();
    const res = await api('/threads?' + q);
    if (!res.ok) return fail(res);
    const rows = res.data.threads || [];
    const html = rows.map(threadRow).join('');
    const more = rows.length >= 30;
    if (append) {
      append.insertAdjacentHTML('beforeend', html);
      append.parentElement.querySelector('.fm-more')?.remove();
    } else {
      main(`<div class="fm-head"><b>${esc(title)}</b></div><div class="fm-list" id="fm-rows">${html || `<div class="fm-note">${esc(t('frm_empty'))}</div>`}</div>`);
    }
    const list = $('#fm-rows');
    if (more) {
      const btn = document.createElement('button');
      btn.className = 's-btn s-btn-sm fm-more'; btn.textContent = t('frm_load_more');
      btn.addEventListener('click', () => viewThreads(params, title, offset + rows.length, list));
      list.after(btn);
    }
    bindThreadRows(list);
  }

  function threadRow(th) {
    return `<button class="fm-item" data-thread="${th.id}">
      <span class="fm-item-main">
        <b>${th.is_pinned ? `<span class="fm-badge">${esc(t('frm_pinned'))}</span>` : ''}${th.is_locked ? `<span class="fm-badge">${esc(t('frm_locked'))}</span>` : (th.is_closed ? `<span class="fm-badge">${esc(t('frm_closed'))}</span>` : '')}${esc(th.title)}${isNewThread(th) ? dot : ''}</b>
        <small>${esc(t('frm_by', { name: th.author || '—' }))}${th.mine ? ' · ' + esc(t('frm_you')) : ''} · ${esc(catPath(th))} · ${esc(when(th.last_post_at))} ${chips(th)}</small>
      </span>
      <span class="fm-stat"><b>${Math.max(0, (th.post_count || 1) - 1)}</b>${esc(t('frm_replies'))}</span>
    </button>`;
  }

  function bindThreadRows(root) {
    root?.querySelectorAll('[data-thread]').forEach(b => b.addEventListener('click', () => viewThread(Number(b.dataset.thread))));
  }

  async function viewLatest(offset = 0) {
    _view = () => viewLatest(); _kind = 'latest'; _appended = false; loading();
    const res = await api('/latest?offset=' + offset + '&lang=' + encodeURIComponent(langParam()) + '&names=' + encodeURIComponent(ownLang()));
    if (!res.ok) return fail(res);
    const posts = res.data.posts || [];
    const m = main(`<div class="fm-list">${posts.map(p => `
      <button class="fm-item" data-thread="${p.thread_id}">
        <span class="fm-item-main"><b>${esc(p.title)}</b>
          <small>${esc(t(p.is_first ? 'frm_started' : 'frm_replied', { name: p.author || '—' }))} · ${esc(catPath(p))} · ${esc(when(p.created_at))} ${chips(p)}</small>
          <small class="fm-snippet">${esc(p.body)}</small></span>
      </button>`).join('') || `<div class="fm-note">${esc(t('frm_empty'))}</div>`}</div>`);
    bindThreadRows(m);
  }

  async function viewWatching() {
    _view = viewWatching; _kind = 'watching'; loading();
    const res = await api('/watching');
    if (!res.ok) return fail(res);
    const rows = res.data.threads || [];
    const m = main(`<div class="fm-head"><b>${esc(t('frm_tab_watching'))}</b></div><div class="fm-list">${rows.map(r => `
      <button class="fm-item" data-thread="${r.id}"><span class="fm-item-main"><b>${r.closed ? `<span class="fm-badge">${esc(t('frm_closed'))}</span>` : ''}${esc(r.title || ('#' + r.id))}</b></span></button>`).join('')
      || `<div class="fm-note">${esc(t('frm_no_watching'))}</div>`}</div>`);
    bindThreadRows(m);
  }

  async function viewThread(id, offset = 0) {
    _view = () => viewThread(id); _kind = 'thread';
    loading();
    const res = await api(`/threads/${id}?offset=${offset}&names=${encodeURIComponent(ownLang())}`);
    if (!res.ok) return fail(res);
    const { thread, posts, last_post_id } = res.data;
    seen.threads[id] = Math.max(seen.threads[id] || 0, last_post_id || 0); saveSeen();
    const closed = !!(thread.is_locked || thread.is_closed);
    let watching = !!res.data.watching;
    const m = main(`
      <div class="fm-head">
        <button class="s-btn s-btn-sm" data-back>← ${esc(t('frm_back'))}</button>
        <span class="fm-grow"></span>
        ${thread.mine && !closed ? `<button class="s-btn s-btn-sm" id="fm-close">${esc(t('frm_close'))}</button>` : ''}
        <button class="s-btn s-btn-sm" id="fm-watch"></button>
        <a class="s-btn s-btn-sm" target="_blank" rel="noopener" href="https://mvmos.org/forum/t/${id}">${esc(t('frm_open_site'))}</a>
      </div>
      <h2 class="fm-title">${thread.is_pinned ? `<span class="fm-badge">${esc(t('frm_pinned'))}</span>` : ''}${thread.is_locked ? `<span class="fm-badge">${esc(t('frm_locked'))}</span>` : (thread.is_closed ? `<span class="fm-badge">${esc(t('frm_closed'))}</span>` : '')}${esc(thread.title)}</h2>
      <div class="fm-crumb">${esc(catPath(thread))} ${chips(thread)}</div>
      <div id="fm-posts">${posts.map(postHtml).join('')}</div>
      ${posts.length >= 100 ? `<button class="s-btn s-btn-sm fm-more" id="fm-more">${esc(t('frm_load_more'))}</button>` : ''}
      ${closed
        ? `<div class="fm-note">${esc(t('frm_err_closed'))}</div>`
        : `<form class="fm-reply"><textarea class="s-input" name="body" rows="4" maxlength="10000" placeholder="${esc(t('frm_reply_ph'))}"></textarea>
             <div class="fm-bad" id="fm-reply-err"></div>
             <div class="fm-row-end"><button class="s-btn s-btn-primary" type="submit">${esc(t('frm_send'))}</button></div></form>`}`);

    m.querySelector('[data-back]').addEventListener('click', () => go('cats'));
    const wbtn = m.querySelector('#fm-watch');
    const paintWatch = () => { wbtn.textContent = watching ? `🔔 ${t('frm_unwatch')}` : `🔕 ${t('frm_watch')}`; };
    paintWatch();
    wbtn.addEventListener('click', async () => {
      const r = watching
        ? await api(`/watch/${id}`, { method: 'DELETE' })
        : await api(`/watch/${id}`, { method: 'PUT', body: { title: thread.title, seen: last_post_id } });
      if (r.ok) { watching = !watching; paintWatch(); }
    });
    m.querySelector('#fm-close')?.addEventListener('click', async () => {
      if (!await mvmOS.confirm(t('frm_close_confirm'), { ok: t('frm_close'), cancel: t('frm_cancel'), danger: true })) return;
      const r = await api(`/threads/${id}/close`, { method: 'POST' });
      if (!r.ok) return alert(errorText(r.error));
      viewThread(id);
    });
    m.querySelector('#fm-more')?.addEventListener('click', () => viewThread(id, offset + posts.length));
    bindPosts(m, id, posts);

    const form = m.querySelector('.fm-reply');
    form?.addEventListener('submit', async e => {
      e.preventDefault();
      const body = form.body.value;
      if (!body.trim()) return;
      const r = await write(() => api(`/threads/${id}/posts`, { method: 'POST', body: { body } }));
      if (!r.ok) { m.querySelector('#fm-reply-err').textContent = errorText(r.error); return; }
      viewThread(id);
    });
  }

  function postHtml(p) {
    return `<article class="fm-post" data-post="${p.id}">
      <header><b>${esc(p.author || '—')}</b>${p.guest ? `<span class="fm-chip">${esc(t('frm_guest'))}</span>` : ''}${p.staff ? `<span class="fm-chip">${esc(t('frm_team'))}</span>` : ''}${p.mine ? `<span class="fm-badge">${esc(t('frm_you'))}</span>` : ''}
        <small>${esc(when(p.created_at))}${p.edited_at ? ' · ' + esc(t('frm_edited')) : ''}</small>
        ${p.mine ? `<span class="fm-grow"></span><button class="fm-link" data-edit>${esc(t('frm_edit'))}</button><button class="fm-link fm-bad" data-del>${esc(t('frm_delete'))}</button>` : ''}
      </header>
      <div class="fm-post-body">${textHtml(p.body)}</div>
    </article>`;
  }

  function bindPosts(root, threadId, posts) {
    root.querySelectorAll('.fm-post').forEach(card => {
      const pid = card.dataset.post;
      card.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!await mvmOS.confirm(t('frm_delete_confirm'), { ok: t('frm_delete'), cancel: t('frm_cancel'), danger: true })) return;
        const r = await api(`/posts/${pid}`, { method: 'DELETE' });
        if (!r.ok) return alert(errorText(r.error));
        // The first post is the thread: when it goes, so does the thread.
        if (card === root.querySelector('.fm-post')) go('cats'); else viewThread(threadId);
      });
      card.querySelector('[data-edit]')?.addEventListener('click', () => {
        const box = card.querySelector('.fm-post-body');
        const raw = (posts.find(x => String(x.id) === pid) || {}).body || '';
        box.innerHTML = `<textarea class="s-input" rows="5" maxlength="10000">${esc(raw)}</textarea>
          <div class="fm-bad"></div>
          <div class="fm-row-end"><button class="s-btn s-btn-sm" data-c>${esc(t('frm_cancel'))}</button><button class="s-btn s-btn-sm s-btn-primary" data-s>${esc(t('frm_save'))}</button></div>`;
        box.querySelector('[data-c]').addEventListener('click', () => viewThread(threadId));
        box.querySelector('[data-s]').addEventListener('click', async () => {
          const r = await api(`/posts/${pid}`, { method: 'PUT', body: { body: box.querySelector('textarea').value } });
          if (!r.ok) { box.querySelector('.fm-bad').textContent = errorText(r.error); return; }
          viewThread(threadId);
        });
      });
    });
  }

  async function viewNewThread() {
    _view = viewNewThread; _kind = 'form'; setActive('');
    loading();
    const res = await api('/categories');
    if (!res.ok) return fail(res);
    const tops = res.data.categories || [];
    // Threads go into a category that has no sub-categories; the first level only groups them.
    const option = (c, top) => `<option value="${c.id}" data-scope="${['mvmos', 'apps'].includes(top.slug) ? top.slug : ''}">${esc(catName(c.slug, c.name))}</option>`;
    const options = tops.map(top => (top.children || []).length
      ? `<optgroup label="${esc(catName(top.slug, top.name))}">${top.children.map(k => option(k, top)).join('')}</optgroup>`
      : option(top, top)).join('');
    const m = main(`
      <div class="fm-head"><b>${esc(t('frm_new_thread'))}</b></div>
      <form class="fm-reply" autocomplete="off">
        <label>${esc(t('frm_category'))}</label>
        <select class="s-input" name="category">${options}</select>
        <div class="fm-about" hidden>
          <label>${esc(t('frm_subject'))}</label>
          <div class="fm-suggest-wrap">
            <input class="s-input" name="subject" maxlength="60" placeholder="${esc(t('frm_subject_ph'))}">
            <div class="fm-suggest" hidden></div>
          </div>
        </div>
        <label>${esc(t('frm_msg_lang'))}</label>
        <select class="s-input" name="lang">${Object.entries(LANGS).map(([c, n]) => `<option value="${c}"${c === ownLang() ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <input class="s-input" name="title" maxlength="120" placeholder="${esc(t('frm_title_ph'))}">
        <textarea class="s-input" name="body" rows="9" maxlength="10000" placeholder="${esc(t('frm_body_ph'))}"></textarea>
        <div class="fm-bad" id="fm-new-err"></div>
        <div class="fm-row-end"><button class="s-btn s-btn-primary" type="submit">${esc(t('frm_create'))}</button></div>
      </form>`);
    const form = m.querySelector('form');
    const aboutBox = m.querySelector('.fm-about');
    const list = m.querySelector('.fm-suggest');
    let subject = '', timer = null;
    const scope = () => form.category.selectedOptions[0]?.dataset.scope || '';
    const applyScope = () => { aboutBox.hidden = !scope(); subject = ''; form.subject.value = ''; list.hidden = true; };
    const suggest = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const r = await api(`/subjects?scope=${encodeURIComponent(scope())}&q=${encodeURIComponent(form.subject.value)}&names=${encodeURIComponent(ownLang())}`);
        const items = (r.ok && r.data.subjects) || [];
        list.innerHTML = items.map(i => `<div class="fm-suggest-item" data-s="${esc(i.subject)}" data-n="${esc(i.name)}">${esc(i.name)}</div>`).join('');
        list.hidden = !items.length;
      }, 150);
    };
    list.addEventListener('mousedown', e => {
      const it = e.target.closest('.fm-suggest-item');
      if (!it) return;
      e.preventDefault();
      subject = it.dataset.s; form.subject.value = it.dataset.n; list.hidden = true;
    });
    form.subject.addEventListener('input', () => { subject = ''; suggest(); });
    form.subject.addEventListener('focus', suggest);
    form.subject.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
    form.category.addEventListener('change', applyScope);
    applyScope();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = { category_id: Number(form.category.value), title: form.title.value, body: form.body.value,
                     lang: form.lang.value, subject };
      const r = await write(() => api('/threads', { method: 'POST', body }));
      if (!r.ok) { m.querySelector('#fm-new-err').textContent = errorText(r.error); return; }
      viewThread(r.data.thread_id);
    });
  }

  // ── Window ───────────────────────────────────────────────────────────────
  function openWindow(threadId) {
    Desktop.createWindow({
      id: WIN_ID,
      title: '💬 ' + t('app_forum'),
      width: 760,
      height: 640,
      onMount(body) {
        _body = body;
        frame();
        api('/me').then(res => {
          if (res.status === 403) { main(`<div class="fm-note fm-bad">${esc(t('frm_err_admin_only'))}</div>`); return; }
          _nick = res.ok ? (res.data.nick || '') : '';
          showNick();
        });
        (async () => {
          if (seen.base == null) {   // what existed before the first visit is not "new"
            const all = await api('/categories');
            if (all.ok) { seen.base = Math.max(0, ...(all.data.categories || []).map(c => c.last_post_id || 0)); saveSeen(); }
          }
          if (threadId) viewThread(threadId); else go('cats');
        })();
        clearInterval(_timer);
        _timer = setInterval(pulse, PULSE_EVERY);
        setTimeout(pulse, 4000);
      },
      onClose() { clearInterval(_timer); _timer = null; _body = null; _cats = null; },
    });
  }

  return { openWindow };
})();

window.ForumApp = ForumApp;
