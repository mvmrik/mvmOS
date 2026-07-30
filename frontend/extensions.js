const Extensions = (() => {
  function browser() {
    const firefox = /Firefox\//i.test(navigator.userAgent);
    return firefox
      ? { id: 'firefox', name: 'Firefox', icon: '🦊' }
      : { id: 'chrome', name: 'Chrome / Chromium', icon: '🌐' };
  }

  function closeDialog(overlay) {
    overlay?.remove();
  }

  function instructions(browserId) {
    return browserId === 'firefox'
      ? t('ext_instructions_firefox')
      : t('ext_instructions_chrome');
  }

  function open(appId, appName, appIcon, metadata) {
    document.querySelector('.ext-overlay')?.remove();
    const current = browser();
    const supported = metadata?.targets?.includes(current.id);
    const storeUrl = metadata?.distribution?.[`${current.id}_store_url`] || '';
    const overlay = document.createElement('div');
    overlay.className = 'ext-overlay';
    overlay.innerHTML = `
      <div class="ext-dialog" role="dialog" aria-modal="true">
        <button class="ext-close" title="${t('ext_close')}">✕</button>
        <div class="ext-head">
          <span class="ext-app-icon">${appIcon || '🧩'}</span>
          <div>
            <h2>${t('ext_title', { app: appName })}</h2>
            <div class="ext-browser">${current.icon} ${current.name}</div>
          </div>
        </div>
        <div class="ext-server">
          <strong>${t('ext_initial_server')}</strong>
          <code>${location.origin}</code>
          <span>${t('ext_server_change_hint')}</span>
        </div>
        ${supported ? `
          <p class="ext-instructions">${storeUrl ? t('ext_store_available') : instructions(current.id)}</p>
          <div class="ext-actions">
            ${storeUrl
              ? `<a class="ext-primary" href="${storeUrl}" target="_blank" rel="noopener">${t('ext_install_store')}</a>`
              : `<button class="ext-primary ext-download">${t('ext_generate_download')}</button>`}
          </div>
          <div class="ext-status" aria-live="polite"></div>
        ` : `<p class="ext-error">${t('ext_not_supported', { browser: current.name })}</p>`}
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.ext-close').onclick = () => closeDialog(overlay);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeDialog(overlay);
    });

    const download = overlay.querySelector('.ext-download');
    if (download) {
      download.onclick = async () => {
        const status = overlay.querySelector('.ext-status');
        download.disabled = true;
        status.textContent = t('ext_generating');
        try {
          const url = `/api/extensions/${encodeURIComponent(appId)}/download` +
            `?browser=${encodeURIComponent(current.id)}&server_url=${encodeURIComponent(location.origin)}`;
          const response = await fetch(url);
          if (!response.ok) throw new Error('build_failed');
          const blob = await response.blob();
          const disposition = response.headers.get('Content-Disposition') || '';
          const match = disposition.match(/filename="([^"]+)"/);
          const filename = match ? match[1] : `${appId}-${current.id}.zip`;
          const href = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = href;
          anchor.download = filename;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(href), 1000);
          status.textContent = t('ext_download_ready');
        } catch (_) {
          status.textContent = t('ext_build_error');
          status.classList.add('error');
        } finally {
          download.disabled = false;
        }
      };
    }
  }

  return { browser, open };
})();

window.Extensions = Extensions;
