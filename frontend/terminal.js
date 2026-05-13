// ── Terminal window ──────────────────────────────────────────────────────────

const Terminal = (() => {
  let termCount = 0;

  function openWindow() {
    termCount++;
    const id = 'terminal-' + termCount;
    const title = termCount === 1 ? 'Terminal' : `Terminal (${termCount})`;

    let term, fitAddon, ws;

    Desktop.createWindow({
      id,
      title,
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
            background: '#0d1117',
            foreground: '#c9d1d9',
            cursor:     '#c9d1d9',
            black:      '#0d1117',
            red:        '#ff5555',
            green:      '#50fa7b',
            yellow:     '#f1fa8c',
            blue:       '#6272a4',
            magenta:    '#ff79c6',
            cyan:       '#8be9fd',
            white:      '#f8f8f2',
          },
          cursorBlink: true,
          scrollback: 5000,
          allowProposedApi: true,
        });

        fitAddon = new window.FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        term.open(container);
        fitAddon.fit();

        // WebSocket
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${proto}://${location.host}/ws/terminal`);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
          sendResize();
          const runHandler = e => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(new TextEncoder().encode(e.detail + '\n'));
            }
          };
          document.addEventListener('terminal-run', runHandler);
          ws.onclose_orig = ws.onclose;
        };
        ws.onmessage = e => {
          const data = e.data instanceof ArrayBuffer
            ? new Uint8Array(e.data)
            : e.data;
          term.write(data);
        };
        ws.onclose = () => {
          term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
        };
        ws.onerror = () => {
          term.write('\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n');
        };

        term.onData(data => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(new TextEncoder().encode(data));
          }
        });

        function sendResize() {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }));
          }
        }

        // resize observer
        const ro = new ResizeObserver(() => {
          try { fitAddon.fit(); } catch (_) {}
          sendResize();
        });
        ro.observe(body);

        term.focus();
      },
      onResize() {
        if (fitAddon) {
          try { fitAddon.fit(); } catch (_) {}
        }
      },
    });
  }

  return { openWindow };
})();
