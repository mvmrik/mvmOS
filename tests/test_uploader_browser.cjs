// Shared uploader in a real browser against two real servers (one shares a folder
// the other connects to). PLAYWRIGHT_MODULE=/path/to/playwright-core node tests/test_uploader_browser.cjs
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn, execFileSync} = require('child_process');
const assert = require('assert/strict');
const repo = path.resolve(__dirname, '..');
const freePort = () => new Promise(r => {const s = net.createServer(); s.listen(0, '127.0.0.1', () => {const p = s.address().port; s.close(() => r(p));});});
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvmos-uploader-')), servers = []; let browser;
  try {
    const dirs = ['source', 'receiver'].map(n => {const d = path.join(temp, n); fs.mkdirSync(d); return d;});
    const shared = path.join(dirs[0], 'shared'), landing = path.join(dirs[1], 'landing');
    fs.mkdirSync(shared); fs.mkdirSync(landing);
    const addresses = [];
    for (const dir of dirs) {
      const port = await freePort(), address = 'http://127.0.0.1:' + port; addresses.push(address);
      const child = spawn(process.env.PYTHON || path.join(repo, 'venv/bin/python'), [path.join(__dirname, 'shared_files_browser_fixture.py'), dir, String(port)], {cwd: repo, env: {...process.env, PYTHONPATH: repo}, stdio: ['ignore', 'ignore', 'pipe']});
      let log = ''; child.stderr.on('data', b => log += b); servers.push(child);
      let ok = false;
      for (let i = 0; i < 100; i++) {try {if ((await fetch(address)).ok) {ok = true; break;}} catch {} await new Promise(r => setTimeout(r, 100));}
      assert(ok, log);
    }
    const [sourceURL, receiverURL] = addresses, H = {'Content-Type': 'application/json', 'X-Mvm-Shared-Files': '1'};
    const grant = await (await fetch(sourceURL + '/api/files/sharing', {method: 'POST', headers: H, body: JSON.stringify({path: shared, name: 'NAS', recipient: receiverURL, permissions: ['read', 'upload']})})).json();
    const folder = await (await fetch(receiverURL + '/api/files/remote-folders', {method: 'POST', headers: H, body: JSON.stringify({origin: sourceURL, grant_id: grant.id, secret: grant.secret, name: 'NAS'})})).json();
    const zip = path.join(temp, 'pack.zip'); fs.mkdirSync(path.join(temp, 'pk', 'inner'), {recursive: true}); fs.writeFileSync(path.join(temp, 'pk', 'inner', 'a.txt'), 'in the archive');
    execFileSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],"w");z.write(sys.argv[2]+"/inner/a.txt","inner/a.txt");z.close()', zip, path.join(temp, 'pk')]);
    const zipB64 = fs.readFileSync(zip).toString('base64');

    browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
    const page = await browser.newPage({viewport: {width: 1100, height: 800}}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(receiverURL);
    await page.addScriptTag({url: '/file-picker.js'}); await page.addScriptTag({url: '/uploader.js'});
    const wait = (fn, arg) => page.waitForFunction(fn, arg, {timeout: 60000});
    const state = id => page.evaluate(id => mvmOS.uploader.jobs().find(j => j.id === id)?.state, id);

    // Folder creation returns the new destination on both storage types.
    await page.evaluate(landing => { window.newDestination = mvmOS.filePicker.open({mode:'directory', sources:['server'], server:{roots:[landing],start:landing}}); }, landing);
    await page.click('.mvm-fp [data-new]');
    await page.fill('.mvm-fp [data-newname]', 'Created here');
    await page.locator('.mvm-fp [data-newform]').evaluate(form => form.requestSubmit());
    const created = await page.evaluate(() => window.newDestination);
    assert.equal(created.folder.path, path.join(landing, 'Created here'));
    assert.ok(fs.statSync(created.folder.path).isDirectory());
    await page.evaluate(id => { window.newDestination = mvmOS.filePicker.open({mode:'directory', sources:['shared'], shared:{ids:[id],permission:'upload'}}); }, folder.id);
    await page.click('.mvm-fp [data-new]');
    await page.fill('.mvm-fp [data-newname]', 'Created remotely');
    await page.locator('.mvm-fp [data-newform]').evaluate(form => form.requestSubmit());
    const remoteCreated = await page.evaluate(() => window.newDestination);
    assert.equal(remoteCreated.folder.shared.path, 'Created remotely');
    assert.ok(fs.statSync(path.join(shared, 'Created remotely')).isDirectory());

    // 1. A folder with sub-folders and one file larger than a part, to the server.
    const j1 = await page.evaluate(async landing => {
      const big = new File([new Uint8Array(105 * 1024 * 1024).fill(7)], 'big.bin');
      const files = [{file: big, relativePath: 'Album/big.bin'}, {file: new File(['hello'], 'a.txt'), relativePath: 'Album/Disc 1/a.txt'}, {file: new File([''], 'empty.txt'), relativePath: 'Album/empty.txt'}];
      return mvmOS.uploader.upload({files, destination: {type: 'server', path: landing}}).id;
    }, landing);
    await page.waitForSelector('.mvm-up .mvm-up-job');
    await wait(() => mvmOS.uploader.jobs().every(j => j.state === 'done'));
    assert.equal(fs.statSync(path.join(landing, 'Album', 'big.bin')).size, 105 * 1024 * 1024);
    assert.equal(fs.readFileSync(path.join(landing, 'Album', 'Disc 1', 'a.txt'), 'utf8'), 'hello');
    assert.equal(fs.statSync(path.join(landing, 'Album', 'empty.txt')).size, 0);

    // 2. The same shape of upload into the folder shared from the other server.
    await page.evaluate(async id => mvmOS.uploader.upload({files: [{file: new File([new Uint8Array(9 * 1024 * 1024).fill(3)], 'x.bin'), relativePath: 'Pack/x.bin'}, {file: new File(['two'], 'b.txt'), relativePath: 'Pack/Sub/b.txt'}, {file: new File([''], 'z.txt'), relativePath: 'Pack/z.txt'}], destination: {type: 'shared', folderId: id, path: '', name: 'NAS'}}), folder.id);
    await wait(() => mvmOS.uploader.jobs().every(j => !['waiting', 'uploading'].includes(j.state)));
    assert.equal(await page.evaluate(() => mvmOS.uploader.jobs()[1].state), 'done', await page.evaluate(() => mvmOS.uploader.jobs()[1].error));
    assert.equal(fs.statSync(path.join(shared, 'Pack', 'x.bin')).size, 9 * 1024 * 1024);
    assert.equal(fs.readFileSync(path.join(shared, 'Pack', 'Sub', 'b.txt'), 'utf8'), 'two');
    assert.equal(fs.statSync(path.join(shared, 'Pack', 'z.txt')).size, 0);
    assert.deepEqual(fs.readdirSync(path.join(shared, 'Pack')).sort(), ['Sub', 'x.bin', 'z.txt'], 'no temporary parts are left');

    // 3. An archive is unpacked on arrival when the app asks for it.
    await page.evaluate(async ([landing, b64]) => mvmOS.uploader.upload({files: [new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'pack.zip')], destination: {type: 'server', path: landing}, extract: true}), [landing, zipB64]);
    await wait(() => mvmOS.uploader.jobs().every(j => !['waiting', 'uploading'].includes(j.state)));
    assert.equal(fs.readFileSync(path.join(landing, 'inner', 'a.txt'), 'utf8'), 'in the archive');
    assert.ok(!fs.existsSync(path.join(landing, 'pack.zip')), 'the archive itself is not kept');

    // 4. A second upload waits, the running one can be stopped, then the waiting one runs.
    const stoppedName = 'stopped-' + Date.now() + '.bin';
    await page.evaluate(([landing, stoppedName]) => {
      const big = n => new File([new Uint8Array(300 * 1024 * 1024).fill(1)], n);
      window.__a = mvmOS.uploader.upload({files: [big(stoppedName)], destination: {type: 'server', path: landing}});
      window.__b = mvmOS.uploader.upload({files: [new File(['second'], 'second.txt')], destination: {type: 'server', path: landing}});
    }, [landing, stoppedName]);
    await page.waitForFunction(() => window.__a.state === 'uploading' && window.__b.state === 'waiting');
    await wait(() => window.__a.base + window.__a.part > 0);
    await page.screenshot({path: path.join(temp, 'panel.png')});
    await page.click('.mvm-up-job:nth-child(' + (await page.evaluate(() => mvmOS.uploader.jobs().indexOf(window.__a) + 1)) + ') [data-act=stop]');
    await wait(() => window.__a.state === 'cancelled' && window.__b.state === 'done');
    assert.ok(!fs.existsSync(path.join(landing, stoppedName)), 'a stopped upload leaves no file');
    assert.equal(fs.readFileSync(path.join(landing, 'second.txt'), 'utf8'), 'second');
    const left = fs.existsSync('/tmp/mvmos-uploads') ? fs.readdirSync('/tmp/mvmos-uploads').filter(f => f.endsWith('_' + stoppedName + '.mvmostmp')) : [];
    assert.deepEqual(left, [], 'the stopped upload leaves no temporary file');

    // 5. A path outside what the person may write is reported, not hidden.
    await page.evaluate(() => { window.__c = mvmOS.uploader.upload({files: [new File(['x'], '../evil.txt')], destination: {type: 'server', path: '/proc'}}); });
    await wait(() => window.__c.state === 'failed');
    assert.deepEqual(errors, []);
    console.log('Uploader: folder with parts, shared folder, archive unpack, queue and stop; no page errors.');
    console.log('Panel screenshot:', path.join(temp, 'panel.png'));
  } finally { if (browser) await browser.close(); servers.forEach(s => s.kill()); }
})().catch(e => {console.error(e); process.exit(1);});
