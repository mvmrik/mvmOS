// PLAYWRIGHT_MODULE=/path/to/playwright-core node tests/test_live_activity_browser.cjs
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
  try {
    for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({viewport: {width, height: 850}}), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('http://activity.test/**', route => {
        const request = route.request(), url = new URL(request.url()), token = request.headers()['x-pub-token'];
        let payload = {};
        if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<div id="taskbar"><button id="notif-btn">Bell</button></div><div id="fs-taskbar"><div class="fs-tb-header"><button id="fs-notif-btn">Bell</button></div></div>'});
        if (url.pathname.endsWith('/me')) payload = {id: token};
        if (url.pathname.endsWith('/apps')) payload = [{id: 'tasks', name: 'Tasks', icon: '✓'}];
        if (url.pathname.endsWith('/live')) payload = {items: token === 'alice' ? [{app: 'tasks', title: 'Alice timer', icon: '⏱', state: 'running', elapsed_seconds: 60, actions: []}] : []};
        return route.fulfill({contentType: 'application/json', body: JSON.stringify(payload)});
      });
      await page.goto('http://activity.test/');
      await page.addStyleTag({path: path.join(root, 'frontend/style.css')});
      await page.addStyleTag({path: path.join(root, 'themes', theme === 'light' ? 'light' : 'catppuccin', 'theme.css')});
      await page.evaluate(() => {
        localStorage.setItem('apphub_token', 'alice');
        localStorage.setItem('apphub_activity', JSON.stringify(['alice', 'bob'].map(u => ({id: u, u, app: 'tasks', action: 'add_task', chips: [u + ' private task'], at: new Date().toISOString()}))));
        window.mvmOS = {lang: 'en'};
      });
      await page.addScriptTag({path: path.join(root, 'frontend/datetime-picker.js')});
      await page.addScriptTag({path: path.join(root, 'frontend/livetray.js')});
      await page.evaluate(() => LiveTray.refresh());
      await page.locator('#live-btn').click();
      await page.waitForSelector('#live-panel.open');
      assert((await page.locator('#live-panel').innerText()).includes('alice private task'));
      assert(!(await page.locator('#live-panel').innerText()).includes('bob private task'));
      assert.equal(await page.locator('.lt-live').count(), 1);
      await page.locator('.lt-clear').click();
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('apphub_activity')).map(x => x.u)), ['bob']);
      await page.evaluate(async () => {localStorage.setItem('apphub_token', 'bob'); await LiveTray.refresh();});
      if (!(await page.locator('#live-panel').evaluate(el => el.classList.contains('open')))) await page.locator('#live-btn').click();
      assert((await page.locator('#live-panel').innerText()).includes('bob private task'));
      assert(!(await page.locator('#live-panel').innerText()).includes('Alice timer'));
      await page.evaluate(async () => {localStorage.removeItem('apphub_token'); await LiveTray.refresh();});
      assert.equal(await page.locator('#live-btn').isVisible(), false);
      assert.equal(await page.locator('#live-panel.open').count(), 0);
      assert.deepEqual(errors, []);
      console.log('PASS activity:', width, theme, 'live display, profile isolation, scoped clear, profile switch and logout');
      await page.close();
    }
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exit(1);});
