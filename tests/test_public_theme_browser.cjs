// PLAYWRIGHT_MODULE=/path/to/playwright node tests/test_public_theme_browser.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const layout = read('backend/apphub_pub/layout.js');
// Run the actual appearance setup without starting account requests or chrome.
const appearance = layout.slice(0, layout.indexOf('  function renderAvatar(')) +
  'window.applyPublicTheme=applyTheme;})();';
const pageStyles = read('apps/gamehub/public/index.html').match(/<style>([\s\S]*?)<\/style>/)[1];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    // Exercise the desktop's actual helper and shared controls as well. Keep
    // canvas unavailable to cover browsers that block pixel readback.
    const desktop = await browser.newPage();
    await desktop.setContent('<button class="s-btn">Save</button><div id="taskbar"><button id="start-btn">Start</button></div><div style="display:grid;width:40px"><div class="cal-day cal-today">3</div></div>');
    await desktop.addStyleTag({ content: read('frontend/style.css') });
    await desktop.evaluate(() => {
      HTMLCanvasElement.prototype.getContext = () => { throw Error('Canvas blocked'); };
    });
    const desktopSource = read('frontend/mvmos.js');
    await desktop.addScriptTag({ content: desktopSource.slice(0, desktopSource.indexOf('  // System actions')) + 'return {};})();' });
    for (const theme of ['light', 'catppuccin', 'windows11']) {
      await desktop.addStyleTag({ content: read(`themes/${theme}/theme.css`) });
      await desktop.waitForFunction(() => {
        const expected = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#89b4fa' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
        return getComputedStyle(document.querySelector('.s-btn')).color === expected;
      });
      for (const selector of ['.s-btn', '#start-btn', '.cal-today']) {
        for (const hover of [false, true]) {
          if (hover) await desktop.locator(selector).hover();
          else await desktop.mouse.move(1000, 700);
          await desktop.waitForTimeout(180);
          const ratio = await desktop.locator(selector).evaluate(el => {
            const lum = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
              v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
            }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
            let chain = [], current = el;
            while (current) { chain.unshift(current); current = current.parentElement; }
            let background = [255, 255, 255];
            for (const node of chain) {
              const parts = getComputedStyle(node).backgroundColor.match(/[\d.]+/g).map(Number);
              const alpha = parts.length > 3 ? parts[3] : 1;
              background = background.map((v, i) => parts[i] * alpha + v * (1 - alpha));
            }
            const s = getComputedStyle(el), a = lum(s.color), b = lum(`rgb(${background.join(',')})`);
            return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          });
          assert(ratio >= 4.5, `${theme} ${selector} hover=${hover}: contrast ${ratio}`);
        }
      }
      console.log(`PASS desktop ${theme}: shared buttons, calendar selection and hover`);
    }
    await desktop.close();
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.route('http://appearance.test/**', r => r.request().url().endsWith('/accent-contrast.js') ? r.fulfill({ contentType: 'text/javascript', body: read('frontend/accent-contrast.js') }) : r.fulfill({ contentType: 'text/html', body:
        '<!doctype html><html><head><script src="/accent-contrast.js"></script></head><body><div class="ap-app"><dialog class="ap-message"><div class="ap-message-heading"><h2>Apex Racing</h2></div><p>Start a new career?</p><div class="ap-message-actions"><button class="ap-btn ap-ghost">Cancel</button><button class="ap-btn" id="accept">Confirm</button></div></dialog></div><button id="public-accent" style="background:var(--pub-accent);color:var(--pub-on-accent)">Save</button></body></html>' }));
      await page.goto('http://appearance.test');
      await page.addStyleTag({ content: pageStyles + read('apps/racelandia/public/style.css') +
        ':root{--pub-accent:#60a5fa;--pub-surface1:#181825}' });
      // Colour selection must work even if canvas readback is blocked.
      await page.evaluate(() => {
        HTMLCanvasElement.prototype.getContext = () => { throw Error('Canvas blocked'); };
        localStorage.setItem('apphub_theme', 'dark');
      });
      await page.evaluate(() => document.querySelector('dialog').showModal());
      async function check(theme, expected) {
        await page.evaluate(theme => { if (window.applyPublicTheme) window.applyPublicTheme(theme); }, theme);
        const results = await page.evaluate(() => {
          function luminance(color) {
            const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
              v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
            });
            return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
          }
          return ['accept', 'public-accent'].map(id => {
            const s = getComputedStyle(document.getElementById(id));
            const a = luminance(s.color), b = luminance(s.backgroundColor);
            return { color: s.color, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
          });
        });
        for (const r of results) {
          assert.equal(r.color, expected);
          assert(r.contrast >= 4.5, `${theme}, ${width}: contrast ${r.contrast}`);
        }
      }
      // The standalone game path has no Apps Hub layout at all.
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#accept')).color === 'rgb(0, 0, 0)');
      await check('dark', 'rgb(0, 0, 0)');
      assert.equal(await page.evaluate(() => typeof window.applyPublicTheme), 'undefined');
      // Then cover ordinary pages with the header and live theme controls.
      await page.addScriptTag({ content: appearance });
      await page.screenshot({ path: `/tmp/mvmos-public-contrast-dark-${width}.png` });
      await check('light', 'rgb(255, 255, 255)');
      await page.screenshot({ path: `/tmp/mvmos-public-contrast-light-${width}.png` });
      await check('dark', 'rgb(0, 0, 0)');
      await page.emulateMedia({ colorScheme: 'light' });
      await check('auto', 'rgb(255, 255, 255)');
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#accept')).color === 'rgb(0, 0, 0)');
      await check('auto', 'rgb(0, 0, 0)');
      // An app's darker default accent must choose white instead of assuming
      // all dark-mode accents are pale blue.
      await page.addStyleTag({ content: ':root{--accent:#123456;--pub-accent:#123456}' });
      await check('dark', 'rgb(255, 255, 255)');
      console.log(`PASS public accent contrast at ${width}px: light, dark, live switches, auto and custom accent`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
