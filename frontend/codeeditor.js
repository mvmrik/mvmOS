var CodeEditor = (() => {
  const t = window.t || (k => k);
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
    // An app's server code lives in apps/<id>/api.py — loaded in-process, and
    // may declare either or both routers below. An app stays inside its own
    // folder: whatever it needs from mvmOS it asks the Platform API for, and it
    // never opens core data.db or another app's files. backend/apps/<id>/ is
    // the rare exception, for work that is structurally impossible here
    // (subprocess, system files) — which is why installing such an app asks for
    // the password.
    //
    // This is enforced, not advisory (backend/app_isolation.py): open() and
    // sqlite3.connect() are confined to apps/<id>/ while the app's module
    // loads and while its routes run. Core data.db, /etc, another app's
    // data.db — all raise AppIsolationError. An app that tries it does not
    // even load.
    {
      group: 'Backend',
      name: 'router (api.py)',
      desc: 'Public page router — mounted at /pub/<app-id>',
      snippet: "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get('/')\nasync def index():\n    return {'ok': True}",
    },
    {
      group: 'Backend',
      name: 'desktop_router (api.py)',
      desc: 'Desktop router — /api/apps/<app-id>, behind the session',
      snippet: "from fastapi import APIRouter\n\ndesktop_router = APIRouter()\n\n\n@desktop_router.get('/items')\nasync def items():\n    return []",
    },
    {
      group: 'Backend',
      name: 'router (desktop.py)',
      desc: 'Same as desktop_router, in its own file when api.py grows big',
      snippet: "# apps/<app-id>/desktop.py — mounted at /api/apps/<app-id>\nfrom fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get('/items')\nasync def items():\n    return []",
    },
    {
      group: 'Backend',
      name: 'get_current_session',
      desc: 'Current desktop user inside a route',
      snippet: "import sys\nfrom fastapi import APIRouter, Depends\n\ncurrent_session = sys.modules['backend.auth'].get_current_session\n\ndesktop_router = APIRouter()\n\n\n@desktop_router.get('/me')\nasync def me(session=Depends(current_session)):\n    return {'user': session['effective_user']}",
    },
    {
      group: 'Backend',
      name: "App's own database",
      desc: 'SQLite in apps/<app-id>/data.db — never another app’s',
      snippet: "import os\nimport sqlite3\n\n_DB_PATH = os.path.join(os.path.dirname(__file__), 'data.db')\n\n\ndef _conn():\n    conn = sqlite3.connect(_DB_PATH)\n    conn.row_factory = sqlite3.Row\n    return conn",
    },
    {
      group: 'Backend',
      name: 'Folder isolation (enforced)',
      desc: 'open() and sqlite3.connect() cannot leave apps/<app-id>/',
      snippet: "# Allowed — inside the app's own folder:\n_DB_PATH = os.path.join(os.path.dirname(__file__), 'data.db')\nsqlite3.connect(_DB_PATH)\nopen(os.path.join(os.path.dirname(__file__), 'public', 'x.json'))\n\n# AppIsolationError — core data.db, another app, the system:\n# sqlite3.connect('../../data.db')\n# sqlite3.connect('../budget/data.db')\n# open('/etc/passwd')\n\n# Need something from mvmOS? Use the Platform API.\n# Need the system itself? That is backend/apps/<app-id>/,\n# and installing the app then asks the user for the password.",
    },

    // ── Platform API ─────────────────────────────────────────────────────────
    // The documented way an app gets anything from outside its own folder.
    // In-process (an app's api.py) call the function directly; over HTTP works
    // from a public page or another process. Same data either way.
    {
      group: 'Platform API',
      name: 'get_settings()',
      desc: 'Install-wide currency, locale, date_format (in-process)',
      snippet: "import sys\n\ncfg = sys.modules['backend.platform_api'].get_settings()\ncurrency = cfg['currency']        # 'EUR'\ndate_format = cfg['date_format']  # 'DD/MM/YYYY'",
    },
    {
      group: 'Platform API',
      name: 'GET /api/platform/settings',
      desc: 'Same settings over HTTP (public page / other process)',
      snippet: "const cfg = await fetch('/api/platform/settings').then(r => r.json());\nconsole.log(cfg.currency, cfg.locale, cfg.date_format);",
    },
    {
      group: 'Platform API',
      name: 'GET /api/platform/whoami',
      desc: 'Who is calling — desktop user and/or Apps Hub account',
      snippet: "const who = await fetch('/api/platform/whoami', {\n  headers: { 'X-Pub-Token': token }  // only on a public page\n}).then(r => r.json());\nconsole.log(who.user);          // desktop user, or null\nconsole.log(who.pub_user_id);   // Apps Hub account id, or null",
    },
    {
      group: 'Platform API',
      name: 'GET /api/platform/apps',
      desc: 'Installed app ids — degrade gracefully if one is missing',
      snippet: "const { apps } = await fetch('/api/platform/apps').then(r => r.json());\nif (apps.includes('budget')) { /* offer the integration */ }",
    },
    {
      group: 'Platform API',
      name: 'POST /api/platform/apps/{id}/call',
      desc: "Call another app's api.py (its API must be enabled in Apps Hub)",
      snippet: "const res = await fetch('/api/platform/apps/budget/call', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    method: 'add_to_category',\n    kwargs: { category: 'Savings', amount: 10 }\n  })\n}).then(r => r.json());\n// user_id is filled in from the real caller — never send your own",
    },
    {
      group: 'Platform API',
      name: 'GET /api/platform/credits',
      desc: 'Apps Hub credit balance for the calling account',
      snippet: "const { balance } = await fetch('/api/platform/credits', {\n  headers: { 'X-Pub-Token': token }\n}).then(r => r.json());",
    },
    {
      group: 'Platform API',
      name: 'POST /api/platform/credits/spend',
      desc: 'Spend credits — 402 when the balance is short',
      snippet: "const res = await fetch('/api/platform/credits/spend', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json', 'X-Pub-Token': token },\n  body: JSON.stringify({\n    app_id: 'my-app',\n    amount: 5,\n    reason: 'export',\n    idempotency_key: crypto.randomUUID()  // always — a retry must not charge twice\n  })\n});\nif (res.status === 402) { /* not enough credits */ }",
    },
    {
      group: 'Platform API',
      name: 'POST /api/platform/notify',
      desc: 'Raise an mvmOS notification for the logged-in desktop user',
      snippet: "await fetch('/api/platform/notify', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ title: 'Done', body: 'Export finished', app_id: 'my-app' })\n});",
    },
    {
      group: 'Platform API',
      name: 'GET /api/platform/premium',
      desc: 'Is this install licensed — for what the UI offers, not for gating',
      snippet: "const p = await fetch('/api/platform/premium?app_id=my-app')\n  .then(r => r.json());\np.premium  // this installation holds a valid licence\np.build    // this app's premium/ code is actually on disk\n\n// Use it to label a control, not to protect a feature. The real gate is\n// that an unlicensed install never receives premium/ at all.",
    },

    // ── Premium ──────────────────────────────────────────────────────────────
    // Premium code lives in apps/<id>/premium/ — ordinary app code, loaded
    // confined to the app's own folder. Needing premium is NOT a reason for an
    // app to have a backend.
    //
    // The gate is delivery, not a check. premium.zip is hosted on mvmos.org and
    // never travels in the public store zip; on install/update sync_premium()
    // wipes premium/ and re-fetches it only for a licensed install. Unlicensed
    // means the file is simply absent — there is nothing to bypass.
    //
    // The base app always keeps its schema and its UI controls whole. What is
    // premium is only whether the control does anything.
    {
      group: 'Premium',
      name: 'Base app: call the premium module',
      desc: 'Returns None with no licence — fall back to free behaviour',
      snippet: "import sys\n\n\ndef _feature_enforced(x):\n    mod = sys.modules['backend.premium'].load_premium_backend('my-app')\n    if mod is None or not hasattr(mod, 'is_enforced'):\n        return False   # no premium build: the stored value stays inert\n    return mod.is_enforced(x)",
    },
    {
      group: 'Premium',
      name: 'apps/<id>/premium/backend.py',
      desc: 'The premium half — always re-check is_premium() for expiry',
      snippet: "import sys\n\n\ndef is_enforced(x):\n    # The file being here proves you were licensed when it was fetched,\n    # not that you still are. A licence that lapsed after install leaves\n    # this file behind, so check every time — the heartbeat keeps the\n    # answer at most 10 minutes stale.\n    if not sys.modules['backend.premium'].is_premium():\n        return False\n    base = sys.modules['app_public_my-app']\n    ...",
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
    {
      group: 'System API',
      name: 'GET /api/system/php-ini',
      desc: 'Read PHP FPM php.ini settings',
      snippet: "const res = await fetch('/api/system/php-ini').then(r => r.json());\nconsole.log(res.path);    // e.g. /etc/php/8.3/fpm/php.ini\nconsole.log(res.values);  // { memory_limit: '256M', ... }",
    },
    {
      group: 'System API',
      name: 'POST /api/system/php-ini',
      desc: 'Save PHP FPM php.ini settings (requires root)',
      snippet: "await fetch('/api/system/php-ini', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    values: { memory_limit: '512M', upload_max_filesize: '128M' },\n    sudo_password: 'yourpassword'\n  })\n});",
    },

    {
      group: 'System API',
      name: 'GET /api/system/mysql-cnf',
      desc: 'Read MySQL my.cnf settings',
      snippet: "const res = await fetch('/api/system/mysql-cnf').then(r => r.json());\nconsole.log(res.path);    // e.g. /etc/mysql/my.cnf\nconsole.log(res.values);  // { max_connections: '151', ... }",
    },
    {
      group: 'System API',
      name: 'POST /api/system/mysql-cnf',
      desc: 'Save MySQL my.cnf settings',
      snippet: "await fetch('/api/system/mysql-cnf', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ values: { max_connections: '200' } })\n});",
    },
    {
      group: 'System API',
      name: 'GET /api/system/nginx-conf',
      desc: 'Read nginx.conf settings',
      snippet: "const res = await fetch('/api/system/nginx-conf').then(r => r.json());\nconsole.log(res.path);    // /etc/nginx/nginx.conf\nconsole.log(res.values);  // { worker_processes: 'auto', ... }",
    },
    {
      group: 'System API',
      name: 'POST /api/system/nginx-conf',
      desc: 'Save nginx.conf settings',
      snippet: "await fetch('/api/system/nginx-conf', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ values: { worker_processes: '4', gzip: 'on' } })\n});",
    },
    {
      group: 'System API',
      name: 'POST /api/system/nginx-test',
      desc: 'Validate nginx config with nginx -t',
      snippet: "const r = await fetch('/api/system/nginx-test', { method: 'POST' }).then(r => r.json());\nif (!r.ok) console.error(r.output); // nginx -t error output",
    },
    {
      group: 'System API',
      name: 'GET /api/system/sshd-conf',
      desc: 'Read sshd_config settings',
      snippet: "const res = await fetch('/api/system/sshd-conf').then(r => r.json());\nconsole.log(res.path);    // /etc/ssh/sshd_config\nconsole.log(res.values);  // { Port: '22', PermitRootLogin: 'no', ... }",
    },
    {
      group: 'System API',
      name: 'POST /api/system/sshd-conf',
      desc: 'Save sshd_config settings',
      snippet: "await fetch('/api/system/sshd-conf', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ values: { PasswordAuthentication: 'no', MaxAuthTries: '3' } })\n});",
    },
    {
      group: 'System API',
      name: 'POST /api/system/sshd-test',
      desc: 'Validate sshd config with sshd -t',
      snippet: "const r = await fetch('/api/system/sshd-test', { method: 'POST' }).then(r => r.json());\nif (!r.ok) console.error(r.output); // sshd -t error output",
    },

    {
      group: 'System API',
      name: 'GET /api/system/ufw-status',
      desc: 'Get UFW firewall status and rules',
      snippet: "const r = await fetch('/api/system/ufw-status').then(r => r.json());\n// { enabled: true, rules: [{num, to, action, from}] }",
    },
    {
      group: 'System API',
      name: 'POST /api/system/ufw-toggle',
      desc: 'Toggle UFW on/off',
      snippet: "const r = await fetch('/api/system/ufw-toggle', { method: 'POST' }).then(r => r.json());\n// { enabled: true|false }",
    },
    {
      group: 'System API',
      name: 'POST /api/system/ufw-allow',
      desc: 'Add UFW allow rule',
      snippet: "await fetch('/api/system/ufw-allow', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ rule: '22/tcp' })\n});",
    },
    {
      group: 'System API',
      name: 'POST /api/system/ufw-delete',
      desc: 'Delete UFW rule by number',
      snippet: "await fetch('/api/system/ufw-delete', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ num: 1 })\n});",
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
    if (_win && document.body.contains(_win) && _projectDir === dir) {
      // editor already open for this dir — just switch file
      await _openFile(filepath, filename);
      return;
    }
    if (!_win || !document.body.contains(_win)) {
      _win = null;
      _editor = null;
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
    sidebar.innerHTML = `<div class="ce-loading">${t('ce_loading')}</div>`;
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
      sidebar.innerHTML = `<div class="ce-loading" style="color:#e05555">${t('ce_error_loading_files')}</div>`;
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

    let html = `<div class="ce-hints-title">${t('ce_api_reference')}</div>`;
    for (const [groupName, items] of Object.entries(groups)) {
      html += `<div class="ce-hints-group">${groupName}</div>`;
      html += items.map(h => `
        <div class="ce-hint-item">
          <div class="ce-hint-name">${h.name}</div>
          <div class="ce-hint-desc">${h.desc}</div>
          <button class="ce-hint-insert s-btn" data-i="${h._i}">${t('ce_insert')}</button>
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
          <div class="ce-body" style="display:flex;flex:1;min-height:0;overflow:hidden;position:relative">
            <div class="ce-sidebar as-sidebar" style="width:200px;min-width:140px;border-right:1px solid var(--border);overflow-y:auto;background:var(--surface2);padding:6px 0;flex-shrink:0"></div>
            <div class="ce-editor-wrap" style="flex:1;overflow:hidden;display:flex;flex-direction:column"></div>
          </div>
        `;

        // extra buttons in titlebar
        const titlebar = _win.querySelector('.window-titlebar');
        const saveBtn = document.createElement('button');
        saveBtn.className = 's-btn ce-save';
        saveBtn.style.cssText = 'font-size:.75rem;padding:3px 10px;margin-right:4px';
        saveBtn.textContent = t('ce_save');
        const apiBtn = document.createElement('button');
        apiBtn.className = 's-btn ce-hints-toggle';
        apiBtn.style.cssText = 'font-size:.75rem;padding:3px 10px;margin-right:4px';
        apiBtn.textContent = t('ce_api_button');
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
