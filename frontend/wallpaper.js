const Wallpaper = (() => {
  let _timer = null;
  const _IMG_EXT = new Set(['jpg','jpeg','png','gif','webp','bmp','svg']);

  function _el() { return document.getElementById('desktop-wallpaper'); }

  function _applyLogo(el) {
    el.style.backgroundImage = "url('/logo.png')";
    el.style.backgroundSize = '180px auto';
    el.style.backgroundPosition = 'center';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.opacity = '1';
  }

  async function _applyFolder(el, cfg) {
    let home = '/root', isRoot = true;
    try {
      const d = await (await fetch('/api/auth/whoami')).json();
      const u = d.effective_user;
      home = u === 'root' ? '/root' : `/home/${u}`;
      isRoot = u === 'root';
    } catch {}

    const folder = cfg.wp_folder || '';
    const dir = folder ? `${home}/${folder}` : home;

    let photos = [];
    try {
      const d = await (await fetch(`/api/files?path=${encodeURIComponent(dir)}${isRoot ? '&as_root=true' : ''}`)).json();
      photos = (d.entries || [])
        .filter(e => !(e.is_dir || e.type === 'dir') && _IMG_EXT.has(e.name.split('.').pop().toLowerCase()))
        .map(e => `/api/files/raw?path=${encodeURIComponent(dir + '/' + e.name)}`);
    } catch {}

    if (!photos.length) { _applyLogo(el); return; }

    for (let i = photos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [photos[i], photos[j]] = [photos[j], photos[i]];
    }

    let idx = 0;
    function _show() {
      el.style.opacity = '0';
      setTimeout(() => {
        el.style.backgroundImage = `url('${photos[idx]}')`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.style.backgroundRepeat = 'no-repeat';
        el.style.opacity = '1';
        idx = (idx + 1) % photos.length;
      }, 600);
    }
    _show();
    const mins = parseInt(cfg.wp_period || '10');
    _timer = setInterval(_show, mins * 60 * 1000);
  }

  async function apply() {
    clearInterval(_timer);
    _timer = null;
    const el = _el();
    if (!el) return;

    let cfg = {};
    try { cfg = await (await fetch('/api/settings')).json(); } catch {}

    const type = cfg.wp_type || 'logo';

    if (type === 'logo') {
      _applyLogo(el);
    } else if (type === 'static') {
      const path = cfg.wp_static_path || '';
      if (path) {
        el.style.backgroundImage = `url('/api/files/raw?path=${encodeURIComponent(path)}')`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.style.backgroundRepeat = 'no-repeat';
        el.style.opacity = '1';
      } else {
        _applyLogo(el);
      }
    } else if (type === 'folder') {
      await _applyFolder(el, cfg);
    }
  }

  window.addEventListener('wallpaper-changed', apply);

  return { apply };
})();
