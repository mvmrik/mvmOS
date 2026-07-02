/**
 * mvmOS Upload Manager
 * Global OS window — progress, speed, queue, Stop button.
 *
 * API: mvmOS.upload.start({ file, chunkEndpoint, cancelEndpoint,
 *                           fields, noFinalize, onDone, onError, onCancel })
 */
(function () {
  const CHUNK_SIZE = 80 * 1024 * 1024;
  const WIN_ID = '__upload_manager__';

  /* ── State ──────────────────────────────────────────────────────────────── */
  let _body     = null;
  let _closeBtn = null;
  let _running  = false;
  let _queue    = [];
  let _stopCurrent = null;

  /* ── Helpers ────────────────────────────────────────────────────────────── */
  function _fmt(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB/s';
    if (bytes >= 1024)    return Math.round(bytes / 1024) + ' KB/s';
    return bytes + ' B/s';
  }

  function _lockClose()   { if (_closeBtn) { _closeBtn.style.opacity = '.25'; _closeBtn.style.pointerEvents = 'none'; } }
  function _unlockClose() { if (_closeBtn) { _closeBtn.style.opacity = '';    _closeBtn.style.pointerEvents = '';     } }
  function _maybeUnlock() { if (!_queue.length) _unlockClose(); }

  function _set(sel, val, color) {
    if (!_body) return;
    const el = _body.querySelector(sel);
    if (!el) return;
    el.textContent = val;
    if (color !== undefined) el.style.color = color || '';
  }
  function _setProgress(pct) {
    if (!_body) return;
    _body.querySelector('.um-fill').style.width = pct + '%';
    _set('.um-pct', pct + '%');
  }
  function _setSpeed(bps) { _set('.um-speed', bps > 0 ? _fmt(bps) : ''); }
  function _setStatus(msg, color) { _set('.um-status', msg, color); }

  function _renderQueue() {
    if (!_body) return;
    const el = _body.querySelector('.um-queue');
    if (!el) return;
    if (!_queue.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.innerHTML = _queue.map(t =>
      `<div class="um-qitem">⏳ ${t.file.name}</div>`
    ).join('');
  }

  /* ── Window ─────────────────────────────────────────────────────────────── */
  function _openWindow(cb) {
    if (_body) {
      // already open — just focus
      Desktop.createWindow({ id: WIN_ID, title: '↑ Качване', icon: '📤', width: 340, height: 200, onMount: () => {} });
      cb();
      return;
    }
    Desktop.createWindow({
      id: WIN_ID,
      title: '↑ Качване',
      icon: '📤',
      width: 340,
      height: 200,
      onMount(body) {
        _body = body;
        body.style.cssText = 'padding:12px 14px;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;overflow:hidden';
        body.innerHTML = `
          <div class="um-name" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9"></div>
          <div style="display:flex;align-items:center;gap:7px">
            <div style="flex:1;height:5px;background:var(--surface2,#313244);border-radius:3px;overflow:hidden">
              <div class="um-fill" style="height:100%;width:0%;background:var(--accent,#89b4fa);border-radius:3px;transition:width .12s"></div>
            </div>
            <span class="um-pct" style="flex-shrink:0;font-size:11px;min-width:30px;text-align:right;opacity:.7">0%</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div style="display:flex;gap:10px;font-size:11px;opacity:.7">
              <span class="um-speed"></span>
              <span class="um-status"></span>
            </div>
            <button class="um-stop" style="flex-shrink:0;background:none;border:1px solid var(--surface2,#313244);color:var(--text-muted,#a6adc8);cursor:pointer;border-radius:5px;padding:2px 8px;font-size:11px">■ Stop</button>
          </div>
          <div class="um-queue" style="display:none;border-top:1px solid var(--surface2,#313244);padding-top:8px;overflow-y:auto;max-height:80px"></div>
        `;
        const style = document.createElement('style');
        style.textContent = `
          .um-qitem{font-size:11px;opacity:.6;padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          @keyframes um-pulse{0%,100%{opacity:1}50%{opacity:.4}}
        `;
        body.appendChild(style);
        _closeBtn = body.closest('.window')?.querySelector('.wbtn-close');
        _lockClose();
        cb();
      },
    });
  }

  /* ── Queue management ───────────────────────────────────────────────────── */
  function _next() {
    if (!_queue.length) {
      _running = false;
      _unlockClose();
      return;
    }
    _running = true;
    _run(_queue.shift());
  }

  /* ── Core runner ────────────────────────────────────────────────────────── */
  function _run(task) {
    _openWindow(() => {
      const file = task.file;
      _set('.um-name', file.name);
      _setProgress(0);
      _setSpeed(0);
      _setStatus('');
      _lockClose();
      if (_body) _body.querySelector('.um-stop').style.display = '';
      _renderQueue();

      let cancelled  = false;
      let currentXHR = null;
      let uploadId   = null;

      // Speed tracking
      let speedStart  = Date.now();
      let speedBytes  = 0;
      let lastSpeedT  = Date.now();
      let lastSpeedB  = 0;

      function _updateSpeed(uploaded) {
        speedBytes = uploaded;
        const now = Date.now();
        const dt = (now - lastSpeedT) / 1000;
        if (dt >= 0.5) {
          const bps = (speedBytes - lastSpeedB) / dt;
          _setSpeed(bps);
          lastSpeedT = now;
          lastSpeedB = speedBytes;
        }
      }

      const done = (data) => {
        _stopCurrent = null;
        _setSpeed(0);
        if (_body) _body.querySelector('.um-stop').style.display = 'none';
        task.onDone && task.onDone(data || {});
        _next();
        _renderQueue();
      };

      const fail = (msg) => {
        _stopCurrent = null;
        _setSpeed(0);
        _setStatus('✗ ' + msg, '#f38ba8');
        _maybeUnlock();
        task.onError && task.onError(msg);
        setTimeout(() => { _next(); _renderQueue(); }, 3000);
      };

      const stop = () => {
        if (cancelled) return;
        cancelled = true;
        if (currentXHR) { currentXHR.abort(); currentXHR = null; }
        if (uploadId && task.cancelEndpoint) {
          fetch(task.cancelEndpoint + '?upload_id=' + encodeURIComponent(uploadId), { method: 'DELETE' }).catch(() => {});
        }
        task.onCancel && task.onCancel();
        _setSpeed(0);
        _setStatus('Спряно', '#a6adc8');
        _maybeUnlock();
        setTimeout(() => { _next(); _renderQueue(); }, 1500);
      };

      _stopCurrent = stop;
      if (_body) _body.querySelector('.um-stop').onclick = stop;

      const fields = task.fields || {};

      /* ── Chunked ── */
      if (file.size > CHUNK_SIZE && task.chunkEndpoint) {
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        uploadId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        let chunk = 0;
        const bytesDone = () => chunk * CHUNK_SIZE;

        const sendChunk = () => {
          if (cancelled) return;
          const start = chunk * CHUNK_SIZE;
          const blob = file.slice(start, start + CHUNK_SIZE);
          const fd = new FormData();
          fd.append('upload_id', uploadId);
          fd.append('chunk_index', chunk);
          fd.append('total_chunks', totalChunks);
          fd.append('filename', file.name);
          if (task.noFinalize) fd.append('no_finalize', '1');
          for (const [k, v] of Object.entries(fields)) fd.append(k, v);
          fd.append('file', blob);

          const xhr = new XMLHttpRequest();
          currentXHR = xhr;
          xhr.open('POST', task.chunkEndpoint);
          xhr.upload.addEventListener('progress', e => {
            if (cancelled || !e.lengthComputable) return;
            const uploaded = bytesDone() + e.loaded;
            _setProgress(Math.min(100, Math.round(uploaded / file.size * 100)));
            _updateSpeed(uploaded);
          });
          xhr.addEventListener('load', () => {
            if (cancelled) return;
            if (xhr.status >= 400) {
              let msg = `Error ${xhr.status}`;
              try { msg = JSON.parse(xhr.responseText).detail || msg; } catch (_) {}
              fail(msg); return;
            }
            chunk++;
            _setProgress(Math.min(100, Math.round(bytesDone() / file.size * 100)));
            if (chunk < totalChunks) { sendChunk(); return; }
            let data = {};
            try { data = JSON.parse(xhr.responseText); } catch (_) {}
            done(data);
          });
          xhr.addEventListener('error', () => { if (!cancelled) fail('Network error'); });
          xhr.send(fd);
        };
        sendChunk();
        return;
      }

      /* ── Simple XHR ── */
      const fd = new FormData();
      if (task.chunkEndpoint) {
        // chunkEndpoint expects the same chunk-protocol fields even for a single-shot upload
        uploadId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        fd.append('upload_id', uploadId);
        fd.append('chunk_index', 0);
        fd.append('total_chunks', 1);
        fd.append('filename', file.name);
        if (task.noFinalize) fd.append('no_finalize', '1');
      }
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      fd.append('file', file);

      const xhr = new XMLHttpRequest();
      currentXHR = xhr;
      xhr.open('POST', task.chunkEndpoint || task.endpoint || '/api/files/upload');
      xhr.upload.addEventListener('progress', e => {
        if (cancelled || !e.lengthComputable) return;
        _setProgress(Math.round(e.loaded / e.total * 100));
        _updateSpeed(e.loaded);
      });
      xhr.addEventListener('load', () => {
        if (cancelled) return;
        if (xhr.status === 413) { fail('Файлът е твърде голям'); return; }
        if (xhr.status >= 400) {
          let msg = `Error ${xhr.status}`;
          try { msg = JSON.parse(xhr.responseText).detail || msg; } catch (_) {}
          fail(msg); return;
        }
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (_) {}
        done(data);
      });
      xhr.addEventListener('error', () => { if (!cancelled) fail('Network error'); });
      xhr.send(fd);
    });
  }

  /* ── MutationObserver — reset _body when window is closed ──────────────── */
  const _observer = new MutationObserver(() => {
    if (_body && !document.body.contains(_body)) {
      _body = null;
      _closeBtn = null;
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    _observer.observe(document.body, { childList: true, subtree: false });
  });

  /* ── Public API ─────────────────────────────────────────────────────────── */
  function _checkAccept(file, accept) {
    if (!accept || !accept.length) return null;
    const name = file.name.toLowerCase();
    const mime = file.type || '';
    const ok = accept.some(a => {
      a = a.toLowerCase().trim();
      if (a.startsWith('.')) return name.endsWith(a);
      if (a.endsWith('/*')) return mime.startsWith(a.slice(0, -1));
      return mime === a;
    });
    if (!ok) return `Неразрешен тип файл. Позволени: ${accept.join(', ')}`;
    return null;
  }

  const _upload = {
    setStatus(msg, processing) {
      _setStatus(msg);
      if (!_body) return;
      _body.querySelector('.um-fill').style.animation = processing ? 'um-pulse 1.2s ease-in-out infinite' : '';
    },
    clearStatus() {
      _setStatus('');
      if (_body) _body.querySelector('.um-fill').style.animation = '';
    },
    start(opts) {
      const err = _checkAccept(opts.file, opts.accept);
      if (err) {
        opts.onError && opts.onError(err);
        // Show error in window if open, otherwise just callback
        _openWindow(() => {
          _set('.um-name', opts.file.name);
          _setProgress(0);
          _setSpeed(0);
          _setStatus('✗ ' + err, '#f38ba8');
          _maybeUnlock();
        });
        return;
      }
      if (_running) {
        _queue.push(opts);
        _renderQueue();
      } else {
        _running = true;
        _run(opts);
      }
    },
  };

  if (typeof mvmOS !== 'undefined') {
    mvmOS.upload = _upload;
  } else {
    window.addEventListener('load', () => {
      if (typeof mvmOS !== 'undefined') mvmOS.upload = _upload;
    });
  }
})();
