// ── Media Viewer (Image + Video) ─────────────────────────────────────────────

const ImageViewer = (() => {
  const IMAGE_EXTS = ['jpg','jpeg','png','gif','webp','bmp','svg','ico'];

  function isImage(name) {
    return IMAGE_EXTS.includes(name.split('.').pop().toLowerCase());
  }

  function openWindow(path, siblings) {
    const name = path.split('/').pop();
    const imgs = (siblings || []).filter(s => isImage(s.name));
    let idx = imgs.findIndex(s => s.name === name);

    const id = 'imageviewer-' + btoa(path).slice(0, 12);
    const win = Desktop.createWindow({
      id,
      title: '🖼️ ' + name,
      width: 800,
      height: 560,
      onMount(body) {
        body.style.cssText = 'display:flex;flex-direction:column;height:100%;background:#0d1117;overflow:hidden;';
        body.innerHTML = `
          <div style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;" id="iv-stage">
            <img id="iv-img" style="max-width:100%;max-height:100%;object-fit:contain;user-select:none;" draggable="false">
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface);border-top:1px solid var(--border);flex-shrink:0;">
            <button id="iv-prev" class="s-btn" style="padding:3px 10px;">‹</button>
            <span id="iv-label" style="flex:1;text-align:center;font-size:.8rem;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
            <button id="iv-next" class="s-btn" style="padding:3px 10px;">›</button>
            <button id="iv-zoom-out" class="s-btn" style="padding:3px 8px;">−</button>
            <button id="iv-zoom-in"  class="s-btn" style="padding:3px 8px;">+</button>
            <button id="iv-zoom-fit" class="s-btn" style="padding:3px 8px;">⊡</button>
          </div>
        `;
        const img     = body.querySelector('#iv-img');
        const label   = body.querySelector('#iv-label');
        const btnPrev = body.querySelector('#iv-prev');
        const btnNext = body.querySelector('#iv-next');
        let zoom = 1;

        function load(i) {
          idx = ((i % imgs.length) + imgs.length) % imgs.length;
          const entry = imgs[idx];
          const p = path.substring(0, path.lastIndexOf('/') + 1) + entry.name;
          img.src = `/api/files/raw?path=${encodeURIComponent(p)}`;
          label.textContent = `${entry.name}  (${idx + 1}/${imgs.length})`;
          zoom = 1;
          img.style.transform = '';
        }

        btnPrev.addEventListener('click', () => load(idx - 1));
        btnNext.addEventListener('click', () => load(idx + 1));
        body.querySelector('#iv-zoom-in').addEventListener('click', () => { zoom = Math.min(zoom * 1.25, 8); img.style.transform = `scale(${zoom})`; });
        body.querySelector('#iv-zoom-out').addEventListener('click', () => { zoom = Math.max(zoom / 1.25, 0.1); img.style.transform = `scale(${zoom})`; });
        body.querySelector('#iv-zoom-fit').addEventListener('click', () => { zoom = 1; img.style.transform = ''; });

        body.addEventListener('keydown', e => {
          if (e.key === 'ArrowLeft')  load(idx - 1);
          if (e.key === 'ArrowRight') load(idx + 1);
        }, true);

        if (idx === -1) {
          img.src = `/api/files/raw?path=${encodeURIComponent(path)}`;
          label.textContent = name;
        } else {
          load(idx);
        }
      }
    });
    if (win) win.querySelector('.window-body').parentElement.focus?.();
  }

  return { openWindow, isImage };
})();


const VideoPlayer = (() => {
  const VIDEO_EXTS = ['mp4','webm','ogg','mov','m4v'];
  const AUDIO_EXTS = ['mp3','flac','wav','aac','opus','m4a','wma'];

  function isVideo(name) {
    return VIDEO_EXTS.includes(name.split('.').pop().toLowerCase());
  }

  function isAudio(name) {
    return AUDIO_EXTS.includes(name.split('.').pop().toLowerCase());
  }

  function openWindow(path) {
    const name = path.split('/').pop();
    const ext = name.split('.').pop().toLowerCase();
    const audio = AUDIO_EXTS.includes(ext);
    const id = 'mediaplayer-' + btoa(path).slice(0, 12);
    Desktop.createWindow({
      id,
      title: (audio ? '🎵 ' : '▶ ') + name,
      width: audio ? 420 : 800,
      height: audio ? 120 : 500,
      onMount(body) {
        body.style.cssText = 'display:flex;flex-direction:column;height:100%;background:#000;overflow:hidden;';
        const tag = audio ? 'audio' : 'video';
        body.innerHTML = `
          <${tag} id="vp-media" style="${audio ? 'width:100%;padding:8px;box-sizing:border-box;' : 'flex:1;width:100%;height:100%;'} outline:none;" controls preload="metadata">
            <source src="/api/files/raw?path=${encodeURIComponent(path)}">
          </${tag}>
        `;
        body.querySelector('#vp-media').play().catch(() => {});
      }
    });
  }

  return { openWindow, isVideo, isAudio };
})();


const TextEditor = (() => {
  const TEXT_EXTS = ['txt','md','json','js','py','sh','css','html','xml','yaml','yml','ini','conf','log','csv','ts','env'];

  function isText(name) {
    const ext = name.split('.').pop().toLowerCase();
    return TEXT_EXTS.includes(ext);
  }

  function openWindow(path) {
    const name = path.split('/').pop();
    const id = 'texteditor-' + btoa(path).slice(0, 12);
    Desktop.createWindow({
      id,
      title: '📝 ' + name,
      width: 720,
      height: 500,
      onMount(body) {
        body.style.cssText = 'display:flex;flex-direction:column;height:100%;';
        body.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 10px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0;">
            <span style="font-size:.8rem;color:var(--text-dim);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${path}</span>
            <span id="te-status" style="font-size:.78rem;color:var(--text-dim);"></span>
            <button class="s-btn" id="te-save" style="font-size:.78rem;">💾 Save</button>
          </div>
          <textarea id="te-area" spellcheck="false" style="flex:1;width:100%;background:var(--surface2);color:var(--text);font-family:var(--mono);font-size:.85rem;padding:12px;border:none;outline:none;resize:none;box-sizing:border-box;line-height:1.5;"></textarea>
        `;
        const area   = body.querySelector('#te-area');
        const status = body.querySelector('#te-status');
        const saveBtn = body.querySelector('#te-save');

        // load content
        fetch(`/api/files/raw?path=${encodeURIComponent(path)}&_=${Date.now()}`)
          .then(r => r.text())
          .then(text => { area.value = text; status.textContent = ''; })
          .catch(() => { status.textContent = 'Failed to load'; });

        let dirty = false;
        area.addEventListener('input', () => {
          dirty = true;
          status.textContent = '● unsaved';
          status.style.color = '#f38ba8';
        });

        async function save() {
          saveBtn.disabled = true;
          const res = await fetch('/api/files/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, content: area.value }),
          });
          saveBtn.disabled = false;
          if (res.ok) {
            dirty = false;
            status.textContent = '✓ saved';
            status.style.color = '#50fa7b';
            setTimeout(() => { if (!dirty) status.textContent = ''; }, 2000);
          } else {
            status.textContent = '✗ save failed';
          }
        }

        saveBtn.addEventListener('click', save);
        area.addEventListener('keydown', e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
        });
      }
    });
  }

  return { openWindow, isText };
})();
