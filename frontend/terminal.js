// ── Terminal window ──────────────────────────────────────────────────────────

const Terminal = (() => {
  let termCount = 0;

  const isMobile = () => window.innerWidth < 768 || navigator.maxTouchPoints > 1;

  // ── Open sessions ─────────────────────────────────────────────────────────
  // Every terminal window registers itself, so a command can go to "the terminal
  // in use" — the one last clicked or typed in — and not to all of them. A window
  // that has been closed is no longer in the page and drops out of the list.
  const sessions = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const live = () => {
    for (let i = sessions.length - 1; i >= 0; i--) if (!sessions[i].body.isConnected) sessions.splice(i, 1);
    return sessions;
  };
  function addSession(s) { sessions.push(s); }
  function useSession(s) {
    const i = sessions.indexOf(s);
    if (i !== -1) { sessions.splice(i, 1); sessions.push(s); }
  }

  // Type a line into the terminal in use, opening one first when there is none.
  // Rejects when no terminal came up in time.
  async function run(text) {
    let s = live().at(-1);
    if (!s) {
      openWindow();
      for (let i = 0; i < 30 && !(s = live().at(-1)); i++) await sleep(100);
    }
    if (!s) throw new Error('no terminal');
    for (let i = 0; i < 80 && !s.ready(); i++) await sleep(100);
    if (!s.ready()) throw new Error('terminal not ready');
    if (window.Desktop) Desktop.focusWindow(s.id);
    s.send(text);
  }

  // "Open in Terminal" in the File Manager and the commands in Settings send this.
  document.addEventListener('terminal-run', e => { run(e.detail).catch(() => {}); });

  // The ⚡ button that opens the quick prompt of saved commands.
  function commandsButton(style) {
    const b = document.createElement('button');
    b.textContent = '⚡';
    b.title = t('tc_button') + ' (' + TerminalCommands.shortcutLabel() + ')';
    b.dataset.tcShortcut = '';
    b.style.cssText = style;
    b.addEventListener('click', () => TerminalCommands.openPalette());
    return b;
  }

  // ── Shell connection ──────────────────────────────────────────────────────
  // The connection to a shell can drop at any moment — the computer sleeps,
  // the network changes, the server restarts — and would stay dead until the
  // window is reopened. It reconnects on its own with a growing pause, and at
  // once when the window is typed in, the tab comes back or the network
  // returns. The shell behind a reconnect is always a new one.
  function connectShell(h) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws = null, timer = null, retry = 0, everOpened = false, closed = false;

    function connect() {
      clearTimeout(timer);
      timer = null;
      ws = new WebSocket(`${proto}://${location.host}/ws/terminal`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        retry = 0;
        h.onOpen(everOpened);
        everOpened = true;
      };
      ws.onmessage = e => h.onMessage(e.data);
      ws.onclose = () => {
        if (closed) return;
        if (retry === 0) h.onLost();
        timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
      };
    }

    function wake() {
      if (closed || !ws) return;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) return;
      connect();
    }
    const onVisible = () => { if (!document.hidden) wake(); };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', onVisible);
    connect();

    return {
      isOpen: () => ws.readyState === WebSocket.OPEN,
      wake,
      send(data) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
        else wake();
      },
      close() {
        closed = true;
        clearTimeout(timer);
        window.removeEventListener('online', wake);
        document.removeEventListener('visibilitychange', onVisible);
        ws.onclose = ws.onmessage = null;
        ws.close();
      },
    };
  }

  // ── ANSI → HTML (basic colors for mobile terminal) ───────────────────────
  const ANSI_COLORS = {
    30:'#555',31:'#ff5555',32:'#50fa7b',33:'#f1fa8c',
    34:'#6272a4',35:'#ff79c6',36:'#8be9fd',37:'#f8f8f2',
    90:'#666',91:'#ff6e6e',92:'#69ff94',93:'#ffffa5',
    94:'#d6acff',95:'#ff92df',96:'#a4ffff',97:'#fff',
  };
  function ansiToHtml(text) {
    let html = '';
    let currentStyle = '';
    const parts = text.split(/\x1b\[([0-9;]*)m/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        html += parts[i]
          .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/\r?\n/g,'<br>').replace(/ /g,'&nbsp;');
      } else {
        const codes = parts[i].split(';').map(Number);
        if (codes.includes(0) || parts[i] === '') {
          if (currentStyle) { html += '</span>'; currentStyle = ''; }
        } else {
          const fg = codes.find(c => (c>=30&&c<=37)||(c>=90&&c<=97));
          const bold = codes.includes(1);
          if (fg || bold) {
            if (currentStyle) html += '</span>';
            let style = '';
            if (fg && ANSI_COLORS[fg]) style += `color:${ANSI_COLORS[fg]};`;
            if (bold) style += 'font-weight:bold;';
            html += `<span style="${style}">`;
            currentStyle = style;
          }
        }
      }
    }
    if (currentStyle) html += '</span>';
    return html;
  }

  // ── Mobile terminal ───────────────────────────────────────────────────────
  function openMobileWindow() {
    termCount++;
    const id = 'terminal-' + termCount;
    const title = termCount === 1 ? t('app_terminal') : `${t('app_terminal')} (${termCount})`;
    let conn;

    Desktop.createWindow({
      id, pinKey: 'terminal', title,
      width: Math.min(window.innerWidth, 500),
      height: 420,
      onMount(body) {
        body.style.cssText = 'background:#0d1117;display:flex;flex-direction:column;height:100%;padding:0;overflow:hidden;';

        // ── Input bar at TOP ──
        const inputRow = document.createElement('div');
        inputRow.style.cssText = [
          'display:flex;align-items:center;gap:6px;',
          'padding:6px 8px;border-bottom:1px solid #30363d;',
          'background:#161b22;flex-shrink:0;',
        ].join('');

        const prompt = document.createElement('span');
        prompt.textContent = '$';
        prompt.style.cssText = 'color:#50fa7b;font-family:monospace;font-size:14px;flex-shrink:0;';

        const input = document.createElement('input');
        input.type = 'text';
        input.autocomplete = 'off';
        input.autocorrect = 'off';
        input.autocapitalize = 'none';
        input.spellcheck = false;
        input.placeholder = 'command…';
        input.style.cssText = [
          'flex:1;background:#0d1117;border:1px solid #30363d;border-radius:4px;',
          'outline:none;padding:5px 8px;',
          'color:#c9d1d9;font-family:Consolas,Menlo,monospace;font-size:13px;',
        ].join('');

        const sendBtn = document.createElement('button');
        sendBtn.textContent = '↵';
        sendBtn.style.cssText = [
          'background:#2a6ee0;color:#fff;border:none;border-radius:4px;',
          'padding:5px 12px;font-size:16px;cursor:pointer;flex-shrink:0;',
        ].join('');

        const stopBtn = document.createElement('button');
        stopBtn.textContent = '■';
        stopBtn.title = 'Ctrl+C';
        stopBtn.style.cssText = [
          'background:#da3633;color:#fff;border:none;border-radius:4px;',
          'padding:5px 12px;font-size:16px;cursor:pointer;flex-shrink:0;display:none;',
        ].join('');

        inputRow.appendChild(prompt);
        inputRow.appendChild(input);
        inputRow.appendChild(commandsButton([
          'background:#21262d;color:#f1fa8c;border:1px solid #30363d;border-radius:4px;',
          'padding:5px 10px;font-size:16px;cursor:pointer;flex-shrink:0;',
        ].join('')));
        inputRow.appendChild(sendBtn);
        inputRow.appendChild(stopBtn);

        // ── Output area ──
        const output = document.createElement('pre');
        output.style.cssText = [
          'flex:1;min-height:0;overflow-y:auto;',
          'padding:8px 10px;margin:0;',
          'font-family:Consolas,Menlo,monospace;font-size:13px;',
          'line-height:1.5;color:#c9d1d9;white-space:pre-wrap;word-break:break-all;',
        ].join('');

        body.appendChild(inputRow);
        body.appendChild(output);

        const titleEl = body.closest('.window')?.querySelector('.window-title');

        fetch('/api/auth/whoami').then(r => r.json()).then(d => {
          const u = d.effective_user || '';
          if (u && titleEl) titleEl.textContent = titleEl.textContent + '  —  ' + u;
          if (u) input.placeholder = u === 'root' ? '/root' : '/home/' + u;
        }).catch(() => {});

        let _ready = false;
        let _buf = '';
        let _flushTimer = null;

        function stripEscapes(text) {
          return text
            .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
            .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
            .replace(/\x1b[()][AB012]/g, '')
            .replace(/\x1b[=>]/g, '')
            .replace(/[\x00-\x08\x0e-\x1f]/g, '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
        }

        function flushOutput() {
          let text = stripEscapes(_buf).trim();
          _buf = '';
          if (!text) return;
          // extract and strip trailing shell prompt (user@host:path# / user@host:path$)
          const promptMatch = text.match(/\n?([^\n]*@[^\n]*[\$#])\s*$/);
          if (promptMatch) {
            // show only user@host (strip :path and trailing # / $)
            const shortPrompt = promptMatch[1].trim().replace(/:.*$/, '');
            if (titleEl) titleEl.textContent = shortPrompt;
            text = text.slice(0, text.length - promptMatch[0].length).trimEnd();
            setRunning(false);
          }
          if (!text) return;
          output.textContent = text;
          output.scrollTop = output.scrollHeight;
        }

        // estimate cols based on container width and font size (≈7.8px per char at 13px monospace)
        const estCols = Math.max(40, Math.floor(body.clientWidth / 7.8));

        function notice(key, color) {
          const line = document.createElement('div');
          line.style.color = color;
          line.textContent = '[' + t(key) + ']';
          output.appendChild(line);
          output.scrollTop = output.scrollHeight;
        }

        conn = connectShell({
          onOpen(again) {
            if (again) notice('term_reconnected', '#50fa7b');
            conn.send(JSON.stringify({ type: 'resize', rows: 24, cols: estCols }));
            // set PROMPT_COMMAND to emit OSC 7 (current dir) after every prompt
            setTimeout(() => {
              conn.send(new TextEncoder().encode(`export PROMPT_COMMAND='printf "\\033]7;%s\\007" "$PWD"'\n`));
              setTimeout(() => { _ready = true; }, 600);
            }, 400);
          },
          onMessage: onData,
          onLost() {
            _ready = false;
            setRunning(false);
            notice('term_reconnecting', '#f1fa8c');
          },
        });

        function onData(data) {
          const raw = data instanceof ArrayBuffer
            ? new TextDecoder().decode(new Uint8Array(data)) : data;
          // intercept OSC 7 pwd before stripping
          const m = raw.match(/\x1b\]7;([^\x07]*)\x07/);
          if (m) input.placeholder = m[1].replace(/^file:\/\/[^/]*/, '') || input.placeholder;
          if (!_ready) return;
          _buf += raw;
          clearTimeout(_flushTimer);
          _flushTimer = setTimeout(flushOutput, 80);
        }

        function setRunning(v) {
          stopBtn.style.display = v ? '' : 'none';
        }

        function sendCmd() {
          const cmd = input.value.trim();
          conn.wake();
          if (!cmd || !_ready) return;
          input.value = '';
          _buf = '';
          clearTimeout(_flushTimer);
          output.textContent = '';
          if (!conn.isOpen()) return;
          setRunning(true);
          conn.send(new TextEncoder().encode(cmd + '\n'));
        }

        sendBtn.addEventListener('click', () => { sendCmd(); input.focus(); });
        stopBtn.addEventListener('click', () => {
          if (conn.isOpen()) conn.send(new TextEncoder().encode('\x03'));
          input.focus();
        });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') sendCmd(); });

        const session = {
          id, body,
          ready: () => _ready && conn.isOpen(),
          send(text) { input.value = text; sendCmd(); },
        };
        addSession(session);
        input.addEventListener('focus', () => useSession(session));
        body.addEventListener('mousedown', () => useSession(session));
      },
      onClose() { if (conn) conn.close(); },
    });
  }

  // ── Desktop terminal (xterm.js) ───────────────────────────────────────────
  function openDesktopWindow() {
    termCount++;
    const id = 'terminal-' + termCount;
    const title = termCount === 1 ? t('app_terminal') : `${t('app_terminal')} (${termCount})`;
    let term, fitAddon, conn;

    Desktop.createWindow({
      id, pinKey: 'terminal', title,
      width: 720,
      height: 460,
      onMount(body) {
        body.style.background = '#0d1117';
        body.style.display = 'flex';
        body.style.flexDirection = 'column';

        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:2px 6px;background:#161b22;border-bottom:1px solid #30363d;flex-shrink:0;';
        const hint = document.createElement('span');
        hint.textContent = TerminalCommands.shortcutLabel();
        hint.dataset.tcShortcut = '';
        hint.style.cssText = 'color:#6e7681;font-size:11px;';
        bar.appendChild(hint);
        bar.appendChild(commandsButton('background:none;color:#f1fa8c;border:none;border-radius:4px;padding:0 6px;font-size:14px;cursor:pointer;'));
        body.appendChild(bar);

        const container = document.createElement('div');
        container.style.cssText = 'width:100%;flex:1;min-height:0;padding:2px;';
        body.appendChild(container);

        term = new window.Terminal({
          fontFamily: "'Consolas', 'Menlo', 'Courier New', monospace",
          fontSize: 14,
          lineHeight: 1.2,
          theme: {
            background: '#0d1117', foreground: '#c9d1d9', cursor: '#c9d1d9',
            black: '#0d1117', red: '#ff5555', green: '#50fa7b',
            yellow: '#f1fa8c', blue: '#6272a4', magenta: '#ff79c6',
            cyan: '#8be9fd', white: '#f8f8f2',
          },
          cursorBlink: true,
          scrollback: 5000,
          allowProposedApi: true,
        });

        fitAddon = new window.FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        term.open(container);
        fitAddon.fit();

        // Typed a moment after the shell starts, its first input is not lost.
        let opened = false;
        conn = connectShell({
          onOpen(again) {
            if (again) term.write('\r\n\x1b[32m[' + t('term_reconnected') + ']\x1b[0m\r\n');
            sendResize();
            setTimeout(() => { opened = true; }, 300);
          },
          onMessage(data) {
            term.write(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
          },
          onLost() {
            opened = false;
            term.write('\r\n\x1b[33m[' + t('term_reconnecting') + ']\x1b[0m\r\n');
          },
        });
        term.onData(data => conn.send(new TextEncoder().encode(data)));

        function sendResize() {
          if (conn.isOpen())
            conn.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }));
        }

        const ro = new ResizeObserver(() => {
          try { fitAddon.fit(); } catch (_) {}
          sendResize();
        });
        ro.observe(body);
        term.focus();

        const session = {
          id, body,
          ready: () => opened && conn.isOpen(),
          send(text) {
            conn.send(new TextEncoder().encode(text + '\n'));
            term.focus();
          },
        };
        addSession(session);
        container.addEventListener('focusin', () => useSession(session));
        body.addEventListener('mousedown', () => useSession(session));
      },
      onResize() {
        if (fitAddon) try { fitAddon.fit(); } catch (_) {}
      },
      onClose() {
        if (conn) conn.close();
        if (term) try { term.dispose(); } catch (_) {}
      },
    });
  }

  function openWindow() {
    if (isMobile()) openMobileWindow();
    else openDesktopWindow();
  }

  return { openWindow, run };
})();
