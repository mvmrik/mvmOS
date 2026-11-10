// Isolated browser regression: no real accounts or platform settings are used.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
(async () => {
  const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
  try {
    const page = await browser.newPage();
    let settings = {file_assoc: {}};
    await page.route('http://core.test/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/settings') {
        if (route.request().method() === 'POST') settings = route.request().postDataJSON().settings;
        return route.fulfill({json: settings});
      }
      if (url.pathname === '/api/pub/apphub/me') return route.fulfill({json: {username:'reader', display_name:'Example Reader'}});
      if (url.pathname === '/api/pub/apphub/logout') return route.fulfill({json: {ok:true}});
      return route.fulfill({contentType:'text/html', body:'<!doctype html><html><body></body></html>'});
    });
    await page.goto('http://core.test/');
    await page.evaluate(() => {
      window.t = key => key;
      window.calls = [];
      window.mvmOS = {_apps: {video: {id:'video', name:'Example Player', file_types:['mp4'], openFile:p => calls.push(['app',p])}}};
      window.ImageViewer = {exts:['jpg']};
      window.VideoPlayer = {exts:['mp4'], openWindow:p => calls.push(['builtin',p])};
      window.CodeEditor = {exts:['js']};
      window.TextEditor = {exts:['txt']};
      localStorage.setItem('apphub_token','fictional-token');
    });
    for (const name of ['fileassoc.js','apphub.js']) await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../frontend',name),'utf8')});
    await page.evaluate(() => FileAssoc.open('/example.mp4'));
    await page.waitForSelector('.fa-overlay');
    await page.check('.fa-always');
    await page.click('.fa-ok');
    await page.waitForFunction(() => calls.length === 1);
    assert.equal(settings.file_assoc.mp4,'mediaplayer','remember an explicit built in choice when a Store app competes');
    await page.evaluate(() => FileAssoc.open('/second.mp4'));
    assert.equal(await page.locator('.fa-overlay').count(),0);
    assert.equal(await page.evaluate(() => calls[1][0]),'builtin');
    await page.evaluate(async () => {await FileAssoc.setDefault('mp4','app:video');await FileAssoc.open('/third.mp4');});
    assert.equal(await page.evaluate(() => calls[2][0]),'app');
    await page.evaluate(async () => {mvmOS._apps={};await FileAssoc.open('/fourth.mp4');});
    assert.equal(await page.evaluate(() => calls[3][0]),'builtin','uninstalling the chosen app restores a usable handler');
    await page.evaluate(() => {
      const btn=document.createElement('button');btn.id='profile';document.body.append(btn);
      AppHub.mountWindowProfile(btn,{onSettings:() => calls.push(['settings'])});
    });
    await page.waitForFunction(() => document.querySelector('#profile').title.includes('Example Reader'));
    await page.click('#profile');await page.click('[data-act=settings]');
    assert.equal(await page.evaluate(() => calls.at(-1)[0]),'settings');
    await page.click('#profile');await page.keyboard.press('Escape');
    assert.equal(await page.locator('.win-profile-menu').count(),0);
    await page.click('#profile');await page.click('[data-act=logout]');
    await page.waitForFunction(() => !localStorage.getItem('apphub_token'));
    await page.waitForFunction(() => document.querySelector('#profile').title==='ah_login');
    console.log('PASS: conflicting handlers, saved built in and Store defaults, uninstall fallback, profile settings, Escape and logout.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
