// ── Terminal window ──────────────────────────────────────────────────────────

const Terminal = (() => {
  let termCount = 0;

  const isMobile = () => window.innerWidth < 768 || navigator.maxTouchPoints > 1;

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
    let ws;

    Desktop.createWindow({
      id, title,
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

        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${proto}://${location.host}/ws/terminal`);
        ws.binaryType = 'arraybuffer';
        // estimate cols based on container width and font size (≈7.8px per char at 13px monospace)
        const estCols = Math.max(40, Math.floor(body.clientWidth / 7.8));

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'resize', rows: 24, cols: estCols }));
          // set PROMPT_COMMAND to emit OSC 7 (current dir) after every prompt
          setTimeout(() => {
            ws.send(new TextEncoder().encode(`export PROMPT_COMMAND='printf "\\033]7;%s\\007" "$PWD"'\n`));
            setTimeout(() => { _ready = true; }, 600);
          }, 400);
        };
        ws.onmessage = e => {
          const raw = e.data instanceof ArrayBuffer
            ? new TextDecoder().decode(new Uint8Array(e.data)) : e.data;
          // intercept OSC 7 pwd before stripping
          const m = raw.match(/\x1b\]7;([^\x07]*)\x07/);
          if (m) input.placeholder = m[1].replace(/^file:\/\/[^/]*/, '') || input.placeholder;
          if (!_ready) return;
          _buf += raw;
          clearTimeout(_flushTimer);
          _flushTimer = setTimeout(flushOutput, 80);
        };
        ws.onclose = () => { output.innerHTML += '<span style="color:#ff5555">\n[Connection closed]</span>'; };
        ws.onerror = () => { output.innerHTML = '<span style="color:#ff5555">[WebSocket error]</span>'; };

        function setRunning(v) {
          stopBtn.style.display = v ? '' : 'none';
        }

        function sendCmd() {
          const cmd = input.value.trim();
          if (!cmd || !_ready) return;
          input.value = '';
          _buf = '';
          clearTimeout(_flushTimer);
          output.textContent = '';
          if (ws.readyState !== WebSocket.OPEN) return;
          setRunning(true);
          ws.send(new TextEncoder().encode(cmd + '\n'));
        }

        sendBtn.addEventListener('click', () => { sendCmd(); input.focus(); });
        stopBtn.addEventListener('click', () => {
          if (ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode('\x03'));
          input.focus();
        });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') sendCmd(); });
      },
      onClose() { if (ws) ws.close(); },
    });
  }

  // ── Desktop terminal (xterm.js) ───────────────────────────────────────────
  function openDesktopWindow() {
    termCount++;
    const id = 'terminal-' + termCount;
    const title = termCount === 1 ? t('app_terminal') : `${t('app_terminal')} (${termCount})`;
    let term, fitAddon, ws;

    Desktop.createWindow({
      id, title,
      width: 720,
      height: 460,
      onMount(body) {
        body.style.background = '#0d1117';
        const container = document.createElement('div');
        container.style.cssText = 'width:100%;height:100%;padding:2px;';
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

        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${proto}://${location.host}/ws/terminal`);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
          sendResize();
          document.addEventListener('terminal-run', e => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(new TextEncoder().encode(e.detail + '\n'));
          });
        };
        ws.onmessage = e => {
          term.write(e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : e.data);
        };
        ws.onclose = () => term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
        ws.onerror = () => term.write('\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n');
        term.onData(data => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(new TextEncoder().encode(data));
        });

        function sendResize() {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }));
        }

        const ro = new ResizeObserver(() => {
          try { fitAddon.fit(); } catch (_) {}
          sendResize();
        });
        ro.observe(body);
        term.focus();
      },
      onResize() {
        if (fitAddon) try { fitAddon.fit(); } catch (_) {}
      },
    });
  }

  function openWindow() {
    if (isMobile()) openMobileWindow();
    else openDesktopWindow();
  }

  return { openWindow };
})();
