var CodeEditor = (() => {
  let _win = null;
  let _editor = null;
  let _currentFile = null;
  let _projectId = null;
  let _projectDir = null;
  let _dirty = false;
  let _cmLoaded = false;

  const HINTS = [
    // ── Frontend / mvmOS JS ──────────────────────────────────────────────────
    {
      group: 'mvmOS JS',
      name: 'mvmOS.registerApp(def)',
      desc: 'Register an app in the taskbar/launcher',
      snippet: "mvmOS.registerApp({\n  id: 'my-app',\n  name: 'My App',\n  icon: '🚀',\n  launch() { /* open window */ }\n});",
    },
    {
      group: 'mvmOS JS',
      name: 'mvmOS.openWindow(opts)',
      desc: 'Open a floating window',
      snippet: "mvmOS.openWindow({\n  id: 'my-app',\n  title: 'My App',\n  width: 800,\n  height: 600,\n  content: '<div>Hello</div>'\n});",
    },
    {
      group: 'mvmOS JS',
      name: 'mvmOS.storage.get(key)',
      desc: 'Get a value from localStorage',
      snippet: "const val = mvmOS.storage.get('my-key');",
    },
    {
      group: 'mvmOS JS',
      name: 'mvmOS.storage.set(key, val)',
      desc: 'Save a value to localStorage',
      snippet: "mvmOS.storage.set('my-key', { data: 123 });",
    },
    {
      group: 'mvmOS JS',
      name: 'mvmOS.notify(title, body)',
      desc: 'Show a desktop notification',
      snippet: "mvmOS.notify('Title', 'Message body');",
    },

    // ── Backend boilerplate ──────────────────────────────────────────────────
    {
      group: 'Backend',
      name: 'APIRouter (public.py)',
      desc: 'FastAPI public router skeleton',
      snippet: "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get('/')\nasync def index():\n    return {'ok': True}",
    },
    {
      group: 'Backend',
      name: 'get_current_session',
      desc: 'Require login — get current user',
      snippet: "from fastapi import APIRouter, Depends\nfrom .auth import get_current_session\n\nrouter = APIRouter()\n\n\n@router.get('/me')\nasync def me(session=Depends(get_current_session)):\n    username = session['effective_user']\n    return {'user': username}",
    },
    {
      group: 'Backend',
      name: 'get_conn()',
      desc: 'SQLite connection (mvmOS shared DB)',
      snippet: "from .db import get_conn\n\nwith get_conn() as conn:\n    rows = conn.execute('SELECT * FROM plugins').fetchall()\n    return [dict(r) for r in rows]",
    },

    // ── System API ───────────────────────────────────────────────────────────
    {
      group: 'System API',
      name: 'GET /api/system/hardware',
      desc: 'CPU model, cores, RAM, disks, network, temps, uptime, OS',
      snippet: "const hw = await fetch('/api/system/hardware').then(r => r.json());\nconsole.log(hw.cpu_model, hw.cpu_cores);\nconsole.log(hw.mem_total, hw.mem_used);\nconsole.log(hw.disks);    // [{device, mount, total, used, free, pct}]\nconsole.log(hw.network);  // [{iface, rx_bytes, tx_bytes}]\nconsole.log(hw.temps);    // [{label, temp}]\nconsole.log(hw.uptime, hw.hostname, hw.os, hw.kernel);",
    },
    {
      group: 'System API',
      name: 'GET /api/system/resources',
      desc: 'Live CPU %, RAM usage, disk usage (for polling)',
      snippet: "const res = await fetch('/api/system/resources').then(r => r.json());\nconsole.log(res.cpu_pct);    // 23.4\nconsole.log(res.mem_used, res.mem_total);\nconsole.log(res.disk_used, res.disk_total);",
    },
    {
      group: 'System API',
      name: 'GET /api/system/processes',
      desc: 'Top 120 processes sorted by CPU',
      snippet: "const procs = await fetch('/api/system/processes').then(r => r.json());\n// [{user, pid, cpu, mem, rss, stat, command}]\nprocs.forEach(p => console.log(p.pid, p.cpu + '%', p.command));",
    },
    {
      group: 'System API',
      name: 'POST /api/system/processes/kill',
      desc: 'Send signal to a process',
      snippet: "await fetch('/api/system/processes/kill', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ pid: 1234, signal: 'TERM' })\n});",
    },
    {
      group: 'System API',
      name: 'GET /api/system/services',
      desc: 'List systemd services',
      snippet: "const svcs = await fetch('/api/system/services').then(r => r.json());\n// [{name, description, active, sub, load}]",
    },
    {
      group: 'System API',
      name: 'POST /api/system/services/action',
      desc: 'Start / stop / restart a systemd service',
      snippet: "await fetch('/api/system/services/action', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'nginx', action: 'restart' })\n});",
    },
    {
      group: 'System API',
      name: 'GET /api/system/info',
      desc: 'mvmOS version, update channel',
      snippet: "const info = await fetch('/api/system/info').then(r => r.json());\nconsole.log(info.version);",
    },

    // ── Files API ────────────────────────────────────────────────────────────
    {
      group: 'Files API',
      name: 'GET /api/files',
      desc: 'List directory contents',
      snippet: "const dir = await fetch('/api/files?path=/home/user').then(r => r.json());\n// { path, entries: [{name, type, size, modified, permissions, owner}] }\ndir.entries.forEach(f => console.log(f.name, f.type));",
    },
    {
      group: 'Files API',
      name: 'GET /api/files/raw',
      desc: 'Read a file as text',
      snippet: "const text = await fetch('/api/files/raw?path=/home/user/file.txt').then(r => r.text());",
    },
    {
      group: 'Files API',
      name: 'POST /api/files/write',
      desc: 'Write / overwrite a file',
      snippet: "await fetch('/api/files/write', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ path: '/home/user/file.txt', content: 'hello' })\n});",
    },
    {
      group: 'Files API',
      name: 'POST /api/files/mkdir',
      desc: 'Create a directory',
      snippet: "await fetch('/api/files/mkdir', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ path: '/home/user/new-dir' })\n});",
    },
    {
      group: 'Files API',
      name: 'DELETE /api/files/delete',
      desc: 'Delete a file or directory',
      snippet: "await fetch('/api/files/delete', {\n  method: 'DELETE',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ path: '/home/user/file.txt' })\n});",
    },
    {
      group: 'Files API',
      name: 'POST /api/files/copy',
      desc: 'Copy or move a file/directory',
      snippet: "await fetch('/api/files/copy', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ src: '/home/user/a.txt', dst_dir: '/home/user/docs', move: false })\n});",
    },

    // ── Projects API ─────────────────────────────────────────────────────────
    {
      group: 'Projects API',
      name: 'GET /api/projects',
      desc: 'List all projects for the current user',
      snippet: "const projects = await fetch('/api/projects').then(r => r.json());\n// [{id, name, domain, watching, published, built, has_app, project_dir}]",
    },
    {
      group: 'Projects API',
      name: 'POST /api/projects/{id}/build',
      desc: 'Build & start file watcher for a project',
      snippet: "await fetch('/api/projects/my-project/build', { method: 'POST' });",
    },
    {
      group: 'Projects API',
      name: 'POST /api/projects/{id}/publish',
      desc: 'Publish a project (add to domains)',
      snippet: "await fetch('/api/projects/my-project/publish', { method: 'POST' });",
    },

    // ── Plugins/App Store API ────────────────────────────────────────────────
    {
      group: 'App Store API',
      name: 'GET /api/plugins',
      desc: 'List installed plugins/apps',
      snippet: "const plugins = await fetch('/api/plugins').then(r => r.json());\n// [{id, name, icon, version}]",
    },
    {
      group: 'App Store API',
      name: 'GET /api/plugins/manifest?id=…',
      desc: 'Get manifest for a plugin',
      snippet: "const manifest = await fetch('/api/plugins/manifest?id=my-app').then(r => r.json());",
    },
  ];

  async function _loadCM() {
    if (_cmLoaded) return;
    const base = '/lib';
    function loadScript(src) {
      return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    function loadStyle(href) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = href;
      document.head.appendChild(l);
    }
    loadStyle(`${base}/codemirror.min.css`);
    loadStyle(`${base}/codemirror-dracula.min.css`);
    loadStyle(`${base}/codemirror-dialog.min.css`);
    await loadScript(`${base}/codemirror.min.js`);
    await loadScript(`${base}/codemirror-js.min.js`);
    await loadScript(`${base}/codemirror-python.min.js`);
    await loadScript(`${base}/codemirror-searchcursor.min.js`);
    await loadScript(`${base}/codemirror-dialog.min.js`);
    await loadScript(`${base}/codemirror-search.min.js`);
    _cmLoaded = true;
  }

  const CODE_EXTS = ['js','ts','py','sh','css','html','json','yaml','yml','xml','php','rb','go','rs','c','cpp','h','java','kt','swift','ini','conf','toml','sql','md'];

  function isCode(name) {
    const ext = name.split('.').pop().toLowerCase();
    return CODE_EXTS.includes(ext);
  }

  async function openFile(filepath) {
    const filename = filepath.split('/').pop();
    // derive projectDir as parent directory
    const dir = filepath.substring(0, filepath.lastIndexOf('/'));
    const projectId = dir.split('/').pop();
    if (_win && _projectDir === dir) {
      // editor already open for this dir — just switch file
      await _openFile(filepath, filename);
      return;
    }
    await openWindow(projectId, dir);
    // wait for editor to mount then open the file
    const _waitOpen = setInterval(() => {
      if (_editor) {
        clearInterval(_waitOpen);
        _openFile(filepath, filename);
      }
    }, 50);
  }

  function _modeFor(filename) {
    if (filename.endsWith('.py')) return 'python';
    if (filename.endsWith('.js')) return 'javascript';
    if (filename.endsWith('.json')) return { name: 'javascript', json: true };
    return 'text';
  }

  async function _loadFile(filepath) {
    const res = await fetch('/api/files/raw?path=' + encodeURIComponent(filepath));
    if (!res.ok) throw new Error('Cannot read file');
    return await res.text();
  }

  async function _saveFile(filepath, content) {
    const res = await fetch('/api/files/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filepath, content }),
    });
    return res.ok;
  }

  async function _openFile(filepath, filename) {
    _currentFile = filepath;
    const sidebar = _win?.querySelector('.ce-sidebar');
    if (sidebar) {
      sidebar.querySelectorAll('.ce-file').forEach(el => el.classList.remove('active'));
      sidebar.querySelectorAll('.ce-file[data-path="' + filepath + '"]').forEach(el => el.classList.add('active'));
    }
    const content = await _loadFile(filepath);
    _editor.setValue(content);
    _editor.setOption('mode', _modeFor(filename));
    _dirty = false;
    _updateTitle();
  }

  function _updateTitle() {
    if (!_win) return;
    const name = _currentFile ? _currentFile.split('/').pop() : '';
    const titleEl = _win.querySelector('.window-title');
    if (titleEl) titleEl.textContent = '📝 ' + (_projectId || '') + (name ? ' — ' + name : '') + (_dirty ? ' ●' : '');
  }

  async function _buildSidebar(sidebar) {
    sidebar.innerHTML = '<div class="ce-loading">Loading…</div>';
    try {
      const res = await fetch('/api/files?path=' + encodeURIComponent(_projectDir));
      const data = await res.json();
      const files = (data.entries || data.files || data || []).filter(f => !f.name.startsWith('.') && f.name !== 'mvmos_project.json');
      sidebar.innerHTML = '';

      function renderItems(items, parentEl, basePath) {
        items.sort((a, b) => {
          if (a.type === 'dir' && b.type !== 'dir') return -1;
          if (a.type !== 'dir' && b.type === 'dir') return 1;
          return a.name.localeCompare(b.name);
        });
        items.forEach(f => {
          const el = document.createElement('div');
          el.className = f.type === 'dir' ? 'ce-dir' : 'ce-file';
          el.textContent = (f.type === 'dir' ? '📁 ' : '📄 ') + f.name;
          el.dataset.path = basePath + '/' + f.name;
          if (f.type !== 'dir') {
            el.addEventListener('click', () => _openFile(el.dataset.path, f.name));
          } else {
            el.addEventListener('click', async () => {
              const existing = el.nextElementSibling;
              if (existing && existing.classList.contains('ce-dir-children')) {
                existing.remove(); return;
              }
              const sub = document.createElement('div');
              sub.className = 'ce-dir-children';
              el.after(sub);
              const r2 = await fetch('/api/files?path=' + encodeURIComponent(el.dataset.path));
              const d2 = await r2.json();
              renderItems(d2.entries || d2.files || d2 || [], sub, el.dataset.path);
            });
          }
          parentEl.appendChild(el);
        });
      }
      renderItems(files, sidebar, _projectDir);
    } catch (e) {
      sidebar.innerHTML = '<div class="ce-loading" style="color:#e05555">Error loading files</div>';
    }
  }

  function _buildHintsPanel(container) {
    const panel = document.createElement('div');
    panel.className = 'ce-hints-panel';

    // group hints
    const groups = {};
    HINTS.forEach((h, i) => {
      const g = h.group || 'General';
      if (!groups[g]) groups[g] = [];
      groups[g].push({ ...h, _i: i });
    });

    let html = `<div class="ce-hints-title">API Reference</div>`;
    for (const [groupName, items] of Object.entries(groups)) {
      html += `<div class="ce-hints-group">${groupName}</div>`;
      html += items.map(h => `
        <div class="ce-hint-item">
          <div class="ce-hint-name">${h.name}</div>
          <div class="ce-hint-desc">${h.desc}</div>
          <button class="ce-hint-insert s-btn" data-i="${h._i}">Insert</button>
        </div>`).join('');
    }
    panel.innerHTML = html;

    panel.querySelectorAll('.ce-hint-insert').forEach(btn => {
      btn.addEventListener('click', () => {
        const h = HINTS[parseInt(btn.dataset.i)];
        if (_editor) _editor.replaceSelection(h.snippet);
      });
    });
    container.appendChild(panel);
  }

  async function openWindow(projectId, projectDir) {
    _projectId = projectId;
    _projectDir = projectDir;

    if (_win) { Desktop.closeWindow('codeeditor-' + _projectId); _win = null; }

    await _loadCM();

    Desktop.createWindow({
      id: 'codeeditor-' + projectId,
      title: '📝 ' + projectId,
      width: 1100,
      height: 640,
      onMount(body) {
        _win = body.closest('.window');

        body.innerHTML = `
          <div class="ce-body" style="display:flex;height:100%;overflow:hidden;position:relative">
            <div class="ce-sidebar as-sidebar" style="width:200px;min-width:140px;border-right:1px solid var(--border);overflow-y:auto;background:var(--surface2);padding:6px 0;flex-shrink:0"></div>
            <div class="ce-editor-wrap" style="flex:1;overflow:hidden;display:flex;flex-direction:column"></div>
          </div>
        `;

        // extra buttons in titlebar
        const titlebar = _win.querySelector('.window-titlebar');
        const saveBtn = document.createElement('button');
        saveBtn.className = 's-btn ce-save';
        saveBtn.style.cssText = 'font-size:.75rem;padding:3px 10px;margin-right:4px';
        saveBtn.textContent = 'Save';
        const apiBtn = document.createElement('button');
        apiBtn.className = 's-btn ce-hints-toggle';
        apiBtn.style.cssText = 'font-size:.75rem;padding:3px 10px;margin-right:4px';
        apiBtn.textContent = 'API';
        titlebar.querySelector('.window-controls').after(saveBtn, apiBtn);

        const ceBody   = body.querySelector('.ce-body');
        const sidebar  = body.querySelector('.ce-sidebar');
        const editorWrap = body.querySelector('.ce-editor-wrap');

        _buildSidebar(sidebar);

        const textarea = document.createElement('textarea');
        editorWrap.appendChild(textarea);

        _editor = CodeMirror.fromTextArea(textarea, {
          theme: 'dracula',
          lineNumbers: true,
          tabSize: 2,
          indentWithTabs: false,
          lineWrapping: true,
          autofocus: true,
        });
        _editor.setSize('100%', '100%');
        _editor.on('change', () => { _dirty = true; _updateTitle(); });

        _buildHintsPanel(ceBody);
        ceBody.querySelector('.ce-hints-panel').style.display = 'none';

        saveBtn.addEventListener('click', async () => {
          if (!_currentFile) return;
          const ok = await _saveFile(_currentFile, _editor.getValue());
          if (ok) { _dirty = false; _updateTitle(); }
        });

        const _hideHints = () => {
          ceBody.querySelector('.ce-hints-panel').style.display = 'none';
        };

        apiBtn.addEventListener('click', () => {
          const p = ceBody.querySelector('.ce-hints-panel');
          p.style.display = p.style.display === 'none' ? '' : 'none';
        });

        // hide hints panel on Insert click or click outside it
        ceBody.addEventListener('click', e => {
          const panel = ceBody.querySelector('.ce-hints-panel');
          if (panel.style.display === 'none') return;
          if (e.target.classList.contains('ce-hint-insert')) {
            _hideHints(); return;
          }
          if (!panel.contains(e.target) && e.target !== apiBtn) _hideHints();
        });
        _editor.on('focus', _hideHints);

        // keyboard save
        document.addEventListener('keydown', e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's' && _win) {
            e.preventDefault();
            saveBtn.click();
          }
        });

        // mobile sidebar toggle (sidebar has class as-sidebar so Desktop picks it up)
        Desktop.initMobileSidebar(body);

        // close file on click in sidebar hides it on mobile
        sidebar.addEventListener('click', e => {
          if (e.target.classList.contains('ce-file')) {
            sidebar.classList.remove('mobile-open');
            body.querySelector('.as-sidebar-overlay')?.remove();
          }
        });

        _updateTitle();
      },
    });
  }

  // inject CSS
  const style = document.createElement('style');
  style.textContent = `
    .ce-sidebar { font-size:.82rem; }
    .ce-file, .ce-dir { padding:4px 12px; cursor:pointer; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ce-file:hover, .ce-dir:hover { background:var(--surface); }
    .ce-file.active { background:var(--accent); color:#fff; }
    .ce-dir-children { padding-left:12px; }
    .ce-loading { padding:10px 12px; color:var(--text-dim); font-size:.82rem; }
    .ce-hints-panel { width:240px;min-width:180px;border-left:1px solid var(--border);background:var(--surface2);overflow-y:auto;padding:8px; }
    .ce-hints-title { font-size:.75rem;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px; }
    .ce-hints-group { font-size:.7rem;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin:12px 0 6px;padding-top:8px;border-top:1px solid var(--border); }
    .ce-hint-item { margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border); }
    .ce-hint-name { font-size:.78rem;font-family:monospace;color:var(--accent);margin-bottom:2px; }
    .ce-hint-desc { font-size:.75rem;color:var(--text-dim);margin-bottom:4px; }
    .ce-hint-insert { font-size:.72rem;padding:2px 8px; }
    .CodeMirror { height: 100% !important; font-size: 13px; }
    .CodeMirror-scroll { height: 100%; }
    .ce-editor-wrap .CodeMirror { flex:1; }
  `;
  document.head.appendChild(style);

  return { openWindow, openFile, isCode };
})();
