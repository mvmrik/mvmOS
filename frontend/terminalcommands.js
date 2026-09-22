// ── Saved terminal commands and the quick prompt ────────────────────────────
//
// A personal shelf of commands for the Terminal. A keyboard shortcut (Ctrl+Shift+Space
// unless changed in the prompt itself) or the ⚡ button in a Terminal window opens a prompt: type any command and press Enter, or pick
// one of the saved commands from the list. Nothing runs here — the line is typed
// into the person's own Terminal session by Terminal.run(), so it runs as the same
// Linux user, in the same shell, with the same output and Ctrl+C as anything typed
// by hand.
//
// A saved command can ask for values each time it runs:
//   {{Name}}           free text
//   {{Name=85}}        free text, pre-filled with 85
//   {{Name:dir}}       a folder, with a chooser
//   {{Name:raw}}       inserted as typed, so *.jpg and pipes still work
// Values are shell-quoted unless they are :raw. The text around the placeholders
// is left exactly as written, so a * there is still a glob.

const TerminalCommands = (() => {
  const T = (k, v) => window.t(k, v);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = msg => { if (window.mvmOS && mvmOS.toast) mvmOS.toast(T('tc_button'), msg); };

  let _items = [];
  let _palette = null;          // the open prompt, so the shortcut can toggle it
  let _opening = false;

  // The shortcut is kept per browser: what the operating system or the browser
  // grabs before the page sees it (Ctrl+Alt+Space opens a launcher on some Linux
  // desktops) depends on the computer, not on the account.
  const SHORTCUT_KEY = 'mvmos.terminalcommands.shortcut';
  const DEFAULT_SHORTCUT = { ctrl: true, alt: false, shift: true, meta: false, code: 'Space' };
  let _recording = false;       // the footer button is waiting for a new combination
  let _stopRecording = null;

  function shortcutValid(s) {
    // Ctrl+C, Alt+B and friends belong to the shell, so a plain single-modifier
    // shortcut is refused; function keys are free.
    const mods = [s.ctrl, s.alt, s.shift, s.meta].filter(Boolean).length;
    return /^F\d{1,2}$/.test(s.code) || mods >= 2;
  }
  function loadShortcut() {
    try {
      const s = JSON.parse(localStorage.getItem(SHORTCUT_KEY));
      if (s && typeof s.code === 'string') {
        const v = { ctrl: !!s.ctrl, alt: !!s.alt, shift: !!s.shift, meta: !!s.meta, code: s.code };
        if (shortcutValid(v)) return v;
      }
    } catch (_) {}
    return { ...DEFAULT_SHORTCUT };
  }
  let _shortcut = loadShortcut();

  function shortcutLabel(s = _shortcut) {
    const key = s.code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
    return [s.ctrl && 'Ctrl', s.alt && 'Alt', s.shift && 'Shift', s.meta && 'Meta', key].filter(Boolean).join('+');
  }
  function setShortcut(s) {
    _shortcut = s;
    try { localStorage.setItem(SHORTCUT_KEY, JSON.stringify(s)); } catch (_) {}
    document.querySelectorAll('[data-tc-shortcut]').forEach(el => {
      if (el.tagName === 'BUTTON') el.title = T('tc_button') + ' (' + shortcutLabel() + ')';
      else el.textContent = shortcutLabel();
    });
  }
  const shortcutMatches = (e, s) => e.code === s.code && e.ctrlKey === s.ctrl && e.altKey === s.alt
    && e.shiftKey === s.shift && e.metaKey === s.meta;

  const css = document.createElement('style');
  css.textContent = `
.tcm-ov{position:fixed;inset:0;z-index:99980;background:rgba(0,0,0,.45);display:flex;justify-content:center;align-items:flex-start;padding:min(14vh,120px) 12px 12px;box-sizing:border-box}
.tcm-box{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius,8px);box-shadow:var(--shadow);width:min(640px,100%);max-height:min(78vh,660px);display:flex;flex-direction:column;overflow:hidden}
.tcm-narrow{width:min(540px,100%)}
.tcm-dlg{padding:18px;overflow-y:auto}
.tcm-in-row{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border)}
.tcm-prompt{color:var(--accent);font:700 15px Consolas,Menlo,monospace}
.tcm-in{flex:1;min-width:0;background:transparent;border:none;outline:none;color:var(--text);font:16px Consolas,Menlo,monospace}
.tcm-list{overflow-y:auto;flex:1;min-height:0}
.tcm-row{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-left:3px solid transparent}
.tcm-row:hover,.tcm-row.sel{background:var(--surface2)}
.tcm-row.sel{border-left-color:var(--accent)}
.tcm-main{flex:1;min-width:0}
.tcm-name{font-size:.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tcm-cmd{font:.78rem Consolas,Menlo,monospace;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tcm-cwd{font-size:.7rem;color:var(--text-dim);white-space:nowrap}
.tcm-act{background:none;border:none;color:var(--text-dim);cursor:pointer;padding:4px 7px;border-radius:4px;font-size:.85rem;flex-shrink:0}
.tcm-act:hover{background:var(--border);color:var(--text)}
.tcm-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid var(--border);font-size:.74rem;color:var(--text-dim)}
.tcm-grow{flex:1;min-width:0}
@media (pointer:coarse){.tcm-key{display:none}}
.tcm-empty{padding:16px 14px;font-size:.82rem;color:var(--text-dim)}
.tcm-title{font-size:1rem;font-weight:700;margin-bottom:12px}
.tcm-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.tcm-field>label{font-size:.76rem;color:var(--text-dim)}
.tcm-inline{display:flex;gap:6px;align-items:center}
.tcm-inline>input{flex:1;min-width:0}
.tcm-field input,.tcm-filter{background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:7px 9px;color:var(--text);font-size:.85rem;box-sizing:border-box;width:100%}
.tcm-mono{font-family:Consolas,Menlo,monospace!important}
.tcm-hint{font-size:.72rem;color:var(--text-dim);line-height:1.45;margin:-4px 0 10px}
.tcm-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}
.tcm-chip{font:.74rem Consolas,Menlo,monospace;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:2px 7px;cursor:pointer;color:var(--text)}
.tcm-chip:hover{border-color:var(--accent)}
.tcm-preview{font:.78rem Consolas,Menlo,monospace;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:7px 9px;margin-bottom:12px;word-break:break-all;color:var(--text-dim)}
.tcm-btns{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:14px}
.tcm-err{color:#f38ba8;font-size:.78rem;min-height:16px;margin-top:6px}
.tcm-help{border:1px solid var(--border);border-radius:6px;margin:0 0 10px;overflow:hidden}
.tcm-help-top{display:flex;gap:8px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--border);font-size:.72rem;color:var(--text-dim)}
.tcm-help-body{max-height:230px;overflow:auto;font:.74rem/1.5 Consolas,Menlo,monospace;padding:4px 0}
.tcm-hl{padding:0 10px;white-space:pre-wrap;word-break:break-word}
.tcm-opt{cursor:pointer;color:var(--text)}
.tcm-opt:hover{background:var(--surface2)}
@media (max-width:768px){.tcm-ov{padding-top:8px}}`;
  document.head.appendChild(css);

  // ── Placeholders ─────────────────────────────────────────────────────────
  const PH = /\{\{\s*([^{}:=]+?)\s*(?::\s*(dir|raw|text)\s*)?(?:=([^{}]*))?\}\}/g;

  function parseFields(text) {
    const fields = [], seen = new Set();
    for (const m of text.matchAll(PH)) {
      const label = m[1];
      if (seen.has(label)) continue;                 // the same name asks once
      seen.add(label);
      fields.push({ label, type: m[2] || 'text', def: m[3] ?? '' });
    }
    return fields;
  }

  function quote(v) {
    if (v === '') return "''";
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(v)) return v;
    const q = s => "'" + s.replace(/'/g, "'\\''") + "'";
    // ~ only expands unquoted, so keep the home shortcut outside the quotes.
    if (v === '~') return '~';
    if (v.startsWith('~/')) return '~/' + (v.length > 2 ? q(v.slice(2)) : '');
    return q(v);
  }

  function fill(text, values) {
    const types = {};
    for (const f of parseFields(text)) types[f.label] = f.type;
    return text.replace(PH, (_, label) => {
      const v = values[label] ?? '';
      return types[label] === 'raw' ? v : quote(v);
    });
  }

  // One line for the shell. With a folder set the command runs in a subshell, so
  // the terminal itself is not left standing in that folder afterwards.
  function buildLine(item, values) {
    const cmd = fill(item.command, values);
    return item.cwd ? `(cd ${quote(item.cwd)} && ${cmd})` : cmd;
  }

  // ── Server ───────────────────────────────────────────────────────────────
  async function api(path, opts) {
    const res = await fetch('/api/terminal' + path, opts);
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }
  const send = (method, path, body) => api(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const loadItems = async () => { _items = await api('/commands'); return _items; };

  // ── Small dialog plumbing ────────────────────────────────────────────────
  function overlay(inner, boxClass) {
    const ov = document.createElement('div');
    ov.className = 'tcm-ov';
    ov.innerHTML = `<div class="tcm-box ${boxClass || ''}" role="dialog">${inner}</div>`;
    document.body.appendChild(ov);
    return ov;
  }
  function onEscape(ov, close) {
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  }

  // ── Asking for the values of a command ───────────────────────────────────
  function askParams(item, fields) {
    return new Promise(resolve => {
      const ov = overlay(`<form class="tcm-dlg" autocomplete="off">
        <div class="tcm-title">▶ ${esc(item.name || item.command)}</div>
        <div class="tcm-preview"></div>
        ${fields.map((f, i) => `<div class="tcm-field"><label>${esc(f.label)}</label>
          <div class="tcm-inline"><input type="text" data-i="${i}" value="${esc(f.def)}" spellcheck="false" autocapitalize="none">
          ${f.type === 'dir' ? `<button type="button" class="s-btn s-btn-sm" data-pick="${i}" title="${esc(T('tc_pick_folder'))}">📁</button>` : ''}</div></div>`).join('')}
        <div class="tcm-btns"><button type="button" class="s-btn s-btn-sm tcm-cancel">${esc(T('cancel'))}</button>
        <button type="submit" class="s-btn s-btn-sm s-btn-primary">${esc(T('tc_run'))}</button></div></form>`, 'tcm-narrow');
      const inputs = [...ov.querySelectorAll('input[data-i]')];
      const preview = ov.querySelector('.tcm-preview');
      const values = () => Object.fromEntries(fields.map((f, i) => [f.label, inputs[i].value]));
      const refresh = () => { preview.textContent = buildLine(item, values()); };
      const done = v => { ov.remove(); resolve(v); };
      inputs.forEach(inp => inp.addEventListener('input', refresh));
      ov.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => {
        const inp = inputs[+btn.dataset.pick];
        FolderPicker.open({ root: '/', title: T('tc_pick_folder'), onSelect: p => { inp.value = p; refresh(); } });
      }));
      ov.querySelector('form').addEventListener('submit', e => { e.preventDefault(); done(values()); });
      ov.querySelector('.tcm-cancel').addEventListener('click', () => done(null));
      onEscape(ov, () => done(null));
      refresh();
      inputs[0].focus(); inputs[0].select();
    });
  }

  async function runItem(item) {
    const fields = parseFields(item.command);
    let values = {};
    if (fields.length) {
      values = await askParams(item, fields);
      if (!values) return;
    }
    try { await Terminal.run(buildLine(item, values)); }
    catch (_) { toast(T('tc_run_failed')); }
  }

  // ── Help for the command being written ───────────────────────────────────
  const OPT_LINE = /^\s{0,6}(?:-[A-Za-z0-9?]|--[A-Za-z0-9])/;
  const OPT = /(?<![\w-])(--[A-Za-z0-9][\w-]*|-[A-Za-z0-9?])/g;
  const META = /^(?:([= ])(<[^>\s]+>|\[[^\]\s]+\]|[A-Z][A-Z0-9_.-]+)(?=[\s,)]|$)|(<[^>\s]+>))/;

  // "-m, --max=NUM  ..." becomes "--max={{Num}}", so a click on an option that
  // takes a value leaves a placeholder ready to be filled in when it runs.
  function optionSnippet(line) {
    const opts = [...line.matchAll(OPT)];
    if (!opts.length) return '';
    const chosen = opts.find(o => o[1].startsWith('--')) || opts[0];
    const m = line.slice(chosen.index + chosen[1].length).match(META);
    if (!m) return chosen[1];
    const raw = (m[2] || m[3]).replace(/^[<[]|[>\]]$/g, '').replace(/\W+/g, ' ').trim();
    const label = raw ? raw[0].toUpperCase() + raw.slice(1).toLowerCase() : 'Value';
    return chosen[1] + (m[1] === ' ' ? ' ' : m[1] === '=' ? '=' : '') + `{{${label}}}`;
  }

  function insertAtCaret(input, text) {
    const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
    const before = input.value.slice(0, s), after = input.value.slice(e);
    const pre = before && !/\s$/.test(before) ? ' ' : '';
    const post = after && !/^\s/.test(after) ? ' ' : '';
    input.value = before + pre + text + post + after;
    const pos = (before + pre + text).length;
    input.setSelectionRange(pos, pos);
    input.focus();
  }

  // ── Editor ───────────────────────────────────────────────────────────────
  function openEditor(item, prefill) {
    return new Promise(resolve => {
      const ov = overlay(`<form class="tcm-dlg" autocomplete="off">
        <div class="tcm-title">${esc(T(item ? 'tc_edit_title' : 'tc_new_title'))}</div>
        <div class="tcm-field"><label>${esc(T('tc_name'))}</label><input type="text" class="tcm-name-in" maxlength="80"></div>
        <div class="tcm-field"><label>${esc(T('tc_command'))}</label>
          <div class="tcm-inline"><input type="text" class="tcm-cmd-in tcm-mono" maxlength="4000" spellcheck="false" autocapitalize="none" autocorrect="off">
          <button type="button" class="s-btn s-btn-sm tcm-help-btn">❓ ${esc(T('tc_help'))}</button></div>
          <div class="tcm-chips"></div></div>
        <div class="tcm-hint">${esc(T('tc_placeholders_hint'))}</div>
        <div class="tcm-help" style="display:none"></div>
        <div class="tcm-field"><label>${esc(T('tc_cwd'))}</label>
          <div class="tcm-inline"><input type="text" class="tcm-cwd-in tcm-mono" maxlength="500" placeholder="${esc(T('tc_cwd_ph'))}" spellcheck="false">
          <button type="button" class="s-btn s-btn-sm tcm-cwd-pick" title="${esc(T('tc_pick_folder'))}">📁</button></div></div>
        <div class="tcm-err"></div>
        <div class="tcm-btns"><button type="button" class="s-btn s-btn-sm tcm-cancel">${esc(T('cancel'))}</button>
        <button type="submit" class="s-btn s-btn-sm s-btn-primary">${esc(T('save'))}</button></div></form>`, 'tcm-narrow');
      const $ = s => ov.querySelector(s);
      const nameIn = $('.tcm-name-in'), cmdIn = $('.tcm-cmd-in'), cwdIn = $('.tcm-cwd-in');
      nameIn.value = item ? item.name : '';
      cmdIn.value = item ? item.command : (prefill || '');
      cwdIn.value = item ? item.cwd : '';
      const done = v => { ov.remove(); resolve(v); };

      // Names of commands on this machine, while the first word is being typed.
      const chips = $('.tcm-chips');
      let chipTimer = null, chipSeq = 0;
      const refreshChips = () => {
        clearTimeout(chipTimer);
        const caret = cmdIn.selectionStart ?? cmdIn.value.length;
        const m = cmdIn.value.slice(0, caret).match(/^\s*([A-Za-z0-9._+-]+)$/);
        if (!m) { chips.innerHTML = ''; return; }
        const seq = ++chipSeq;
        chipTimer = setTimeout(async () => {
          let names = [];
          try { names = await api('/commands/names?prefix=' + encodeURIComponent(m[1])); } catch (_) {}
          if (seq !== chipSeq) return;
          if (names.length === 1 && names[0] === m[1]) names = [];
          chips.innerHTML = names.map(n => `<span class="tcm-chip" data-n="${esc(n)}">${esc(n)}</span>`).join('');
        }, 150);
      };
      cmdIn.addEventListener('input', refreshChips);
      chips.addEventListener('mousedown', e => e.preventDefault());        // keep the caret
      chips.addEventListener('click', e => {
        const chip = e.target.closest('.tcm-chip');
        if (!chip) return;
        const rest = cmdIn.value.replace(/^\s*[A-Za-z0-9._+-]*/, '');
        cmdIn.value = chip.dataset.n + (rest.startsWith(' ') ? rest : ' ' + rest);
        chips.innerHTML = '';
        const pos = chip.dataset.n.length + 1;
        cmdIn.focus(); cmdIn.setSelectionRange(pos, pos);
      });

      // What the command's own --help (or manual page) says.
      const helpBox = $('.tcm-help');
      $('.tcm-help-btn').addEventListener('click', async () => {
        const word = (cmdIn.value.trim().match(/^[A-Za-z0-9][A-Za-z0-9._+-]*/) || [''])[0];
        helpBox.style.display = '';
        if (!word) { helpBox.innerHTML = `<div class="tcm-help-top">${esc(T('tc_help_none'))}</div>`; return; }
        helpBox.innerHTML = `<div class="tcm-help-top">${esc(T('tc_help_loading'))}</div>`;
        let data;
        try { data = await api('/help?cmd=' + encodeURIComponent(word)); }
        catch (_) { helpBox.innerHTML = `<div class="tcm-help-top">${esc(T('tc_help_none'))}</div>`; return; }
        const lines = data.text.split('\n');
        helpBox.innerHTML = `<div class="tcm-help-top"><input class="tcm-filter" placeholder="${esc(T('tc_help_filter'))}" style="flex:1">
          <span>${esc(T(data.source === 'man' ? 'tc_help_from_man' : 'tc_help_click'))}</span></div>
          <div class="tcm-help-body">${lines.map(l => {
            const snip = OPT_LINE.test(l) ? optionSnippet(l) : '';
            return `<div class="tcm-hl${snip ? ' tcm-opt' : ''}"${snip ? ` data-s="${esc(snip)}"` : ''}>${esc(l) || '&nbsp;'}</div>`;
          }).join('')}</div>`;
        const filter = helpBox.querySelector('.tcm-filter');
        const rows = [...helpBox.querySelectorAll('.tcm-hl')];
        filter.addEventListener('input', () => {
          const q = filter.value.trim().toLowerCase();
          rows.forEach(r => { r.style.display = !q || r.textContent.toLowerCase().includes(q) ? '' : 'none'; });
        });
        helpBox.querySelector('.tcm-help-body').addEventListener('mousedown', e => e.preventDefault());
        helpBox.querySelector('.tcm-help-body').addEventListener('click', e => {
          const row = e.target.closest('.tcm-opt');
          if (row) insertAtCaret(cmdIn, row.dataset.s);
        });
      });

      $('.tcm-cwd-pick').addEventListener('click', () =>
        FolderPicker.open({ root: '/', title: T('tc_pick_folder'), onSelect: p => { cwdIn.value = p; } }));

      const err = $('.tcm-err');
      $('form').addEventListener('submit', async e => {
        e.preventDefault();
        if (!cmdIn.value.trim()) { cmdIn.focus(); return; }
        const body = { name: nameIn.value, command: cmdIn.value, cwd: cwdIn.value };
        try { done(await (item ? send('PUT', '/commands/' + item.id, body) : send('POST', '/commands', body))); }
        catch (_) { err.textContent = T('tc_error_save'); }
      });
      $('.tcm-cancel').addEventListener('click', () => done(null));
      onEscape(ov, () => done(null));
      (item ? cmdIn : nameIn).focus();
    });
  }

  // ── The prompt ───────────────────────────────────────────────────────────
  function locked() {
    return !document.getElementById('desktop')
      || !!(document.getElementById('screensaver') || document.getElementById('ss-unlock'));
  }

  function closePalette() {
    if (_stopRecording) _stopRecording();
    if (_palette) { _palette.remove(); _palette = null; }
  }

  async function openPalette() {
    if (_palette) { closePalette(); return; }
    if (locked() || _opening || document.querySelector('.tcm-ov')) return;
    _opening = true;
    try { await loadItems(); }
    catch (_) { return; }                                   // not signed in, or the server is away
    finally { _opening = false; }

    const ov = overlay(`
      <div class="tcm-in-row"><span class="tcm-prompt">$</span>
        <input class="tcm-in" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="${esc(T('tc_palette_ph'))}"></div>
      <div class="tcm-list"></div>
      <div class="tcm-foot"><span class="tcm-grow">${esc(T('tc_keys'))}</span><button class="s-btn s-btn-sm tcm-key" title="${esc(T('tc_shortcut_change'))}"></button><button class="s-btn s-btn-sm tcm-new"></button></div>`);
    _palette = ov;
    const input = ov.querySelector('.tcm-in'), list = ov.querySelector('.tcm-list'), newBtn = ov.querySelector('.tcm-new'), keyBtn = ov.querySelector('.tcm-key');
    let rows = [], sel = 0;

    const matches = q => {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      return _items.filter(it => { const hay = (it.name + ' ' + it.command).toLowerCase(); return terms.every(x => hay.includes(x)); });
    };

    // Installed apps, offered like the Start menu does: only from three letters
    // on, since one or two match nearly everything. They come after the typed
    // line and the saved commands, so Enter never opens an app by surprise.
    const appMatches = q => {
      if (q.length < 3) return [];
      return (window.mvmOS?.searchApps?.(q) || [])
        .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
        .slice(0, 8);
    };

    function render() {
      const q = input.value.trim();
      rows = q ? [{ typed: q }] : [];
      matches(q).forEach(it => rows.push({ item: it }));
      appMatches(q).forEach(app => rows.push({ app }));
      sel = Math.max(0, Math.min(sel, rows.length - 1));
      newBtn.textContent = q ? '💾 ' + T('tc_save_typed') : '+ ' + T('tc_new');
      if (!rows.length) { list.innerHTML = `<div class="tcm-empty">${esc(T('tc_empty'))}</div>`; return; }
      list.innerHTML = rows.map((r, i) => r.typed
        ? `<div class="tcm-row${i === sel ? ' sel' : ''}" data-i="${i}"><span>▶</span><div class="tcm-main"><div class="tcm-name">${esc(T('tc_run_typed', { cmd: r.typed }))}</div></div></div>`
        : r.app
        ? `<div class="tcm-row${i === sel ? ' sel' : ''}" data-i="${i}"><span>${esc(r.app.icon || '📦')}</span><div class="tcm-main"><div class="tcm-name">${esc(r.app.name || r.app.id)}</div></div><span class="tcm-cwd">${esc(T('tc_app_tag'))}</span></div>`
        : `<div class="tcm-row${i === sel ? ' sel' : ''}" data-i="${i}"><div class="tcm-main"><div class="tcm-name">${esc(r.item.name)}</div>
             <div class="tcm-cmd">${esc(r.item.command)}</div></div>
             ${r.item.cwd ? `<span class="tcm-cwd">📁 ${esc(r.item.cwd)}</span>` : ''}
             <button class="tcm-act" data-act="edit" title="${esc(T('edit'))}">✏️</button>
             <button class="tcm-act" data-act="del" title="${esc(T('delete'))}">🗑</button></div>`).join('');
      list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }

    async function activate(row) {
      if (!row) return;
      if (row.app) { closePalette(); mvmOS.openApp(row.app.id); return; }
      // Typing a saved command's exact text still carries its folder along.
      const item = row.typed ? (_items.find(i => i.command === row.typed) || { command: row.typed, cwd: '' }) : row.item;
      closePalette();
      await runItem(item);
    }

    async function editor(item, prefill) {
      closePalette();
      await openEditor(item, prefill);
      openPalette();                                          // back to the list, refreshed
    }

    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (rows.length) { sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; render(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        activate(rows[sel]);
      } else if (e.key === 'Tab') {
        e.preventDefault();                                   // fill in a saved command to edit it before running
        const r = rows[sel];
        if (r && r.item) { input.value = r.item.command; sel = 0; render(); }
      }
    });
    list.addEventListener('click', async e => {
      const rowEl = e.target.closest('.tcm-row');
      if (!rowEl) return;
      const row = rows[+rowEl.dataset.i];
      const act = e.target.closest('.tcm-act')?.dataset.act;
      if (act === 'edit') { editor(row.item); return; }
      if (act === 'del') {
        const msg = esc(T('tc_delete_confirm', { name: row.item.name }));
        const ok = window.mvmOS && mvmOS.confirm ? await mvmOS.confirm(msg, { ok: T('delete') }) : window.confirm(row.item.name);
        if (!ok) return;
        try { await send('DELETE', '/commands/' + row.item.id); await loadItems(); render(); }
        catch (_) { toast(T('tc_error_save')); }
        return;
      }
      activate(row);
    });
    newBtn.addEventListener('click', () => editor(null, input.value.trim()));

    keyBtn.textContent = '⌨ ' + shortcutLabel();
    keyBtn.addEventListener('click', () => {
      if (_recording) return;
      _recording = true;
      keyBtn.textContent = '⌨ ' + T('tc_shortcut_press');
      const stop = () => {
        window.removeEventListener('keydown', onKey, true);
        _recording = false; _stopRecording = null;
        keyBtn.textContent = '⌨ ' + shortcutLabel();
      };
      const onKey = e => {
        e.preventDefault(); e.stopPropagation();
        if (/^(Control|Alt|Shift|Meta|OS)/.test(e.code)) return;      // wait for the real key
        if (e.code === 'Escape') { stop(); input.focus(); return; }
        const s = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, code: e.code };
        if (!shortcutValid(s)) { toast(T('tc_shortcut_need')); return; }
        setShortcut(s); stop(); input.focus();
      };
      _stopRecording = stop;
      window.addEventListener('keydown', onKey, true);
    });
    onEscape(ov, closePalette);
    render();
    input.focus();
  }

  // The shortcut works from anywhere on the desktop — also while typing in a
  // Terminal, hence the capture phase.
  window.addEventListener('keydown', e => {
    if (_recording || e.repeat || !shortcutMatches(e, _shortcut)) return;
    if (locked()) return;
    e.preventDefault();
    e.stopPropagation();
    openPalette();
  }, true);

  return { openPalette, shortcutLabel };
})();
