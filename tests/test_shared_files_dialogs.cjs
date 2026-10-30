// Real HTTP servers and filesystem, with native dialogs disabled as in Electron.
// PLAYWRIGHT_MODULE=/path/to/playwright-core node tests/test_shared_files_dialogs.cjs
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const {spawn} = require('child_process');
const assert = require('assert/strict');
const repo = path.resolve(__dirname, '..');
const freePort = () => new Promise(resolve => {const s = net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvmos-fm-browser-'));
  const servers = []; let browser;
  try {
    const source = path.join(temp, 'source'), receiver = path.join(temp, 'receiver');
    for (const dir of [source, receiver]) fs.mkdirSync(dir);
    const local = path.join(receiver, 'files'), remote = path.join(source, 'files');
    fs.mkdirSync(local);fs.mkdirSync(remote);
    fs.mkdirSync(path.join(local, 'Album', 'Disc'), {recursive:true});
    const large = Buffer.alloc(4*1024*1024+123, 87);
    fs.writeFileSync(path.join(local,'Album','Disc','Track.bin'),large);
    fs.writeFileSync(path.join(local,'Album','Empty.txt'),'');
    fs.writeFileSync(path.join(remote,'Sample.txt'),'Remote preview');
    const addresses=[];
    for (const dir of [source,receiver]) {
      const port=await freePort(), address='http://127.0.0.1:'+port; addresses.push(address);
      const child=spawn(process.env.PYTHON || path.join(repo,'venv/bin/python'),[path.join(__dirname,'shared_files_browser_fixture.py'),dir,String(port)],{cwd:repo,env:{...process.env,PYTHONPATH:repo},stdio:['ignore','ignore','pipe']});
      let log='';child.stderr.on('data',b=>log+=b);servers.push(child);
      let ready=false;
      for(let i=0;i<100;i++) {try {if((await fetch(address)).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,100));}
      assert(ready, log);
    }
    const [sourceURL,receiverURL]=addresses;
    const grant=await (await fetch(sourceURL+'/api/files/sharing',{method:'POST',headers:{'Content-Type':'application/json','X-Mvm-Shared-Files':'1'},body:JSON.stringify({path:remote,name:'Home files',recipient:receiverURL,permissions:['read','upload','edit','delete']})})).json();
    const folder=await (await fetch(receiverURL+'/api/files/remote-folders',{method:'POST',headers:{'Content-Type':'application/json','X-Mvm-Shared-Files':'1'},body:JSON.stringify({origin:sourceURL,grant_id:grant.id,secret:grant.secret,name:'Home files'})})).json();
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1280,height:850}}), errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
    await page.goto(receiverURL);
    await page.evaluate(local=>FileManager.openWindow(local), local);
    const fm=page.locator('.fm-container').first(), row=name=>fm.locator('.fm-entry').filter({has:page.locator('.fm-name',{hasText:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})});
    await row('Album').waitFor();
    const menu=async (target,label)=>{await target.click({button:'right'});await page.locator('.fm-ctx').getByText(label,{exact:true}).click();};
    await row('Album').click();await page.keyboard.press('Control+c');
    assert.equal(await page.evaluate(()=>window._fmClipboard.paths[0]),path.join(local,'Album'));
    await fm.locator('.fm-places').getByText('Home files',{exact:true}).click();
    await row('Sample.txt').waitFor();
    assert.equal(await page.locator('.fm-container').count(),1,'Sidebar opens inside the existing File Manager');
    assert.equal(await page.locator('.sf-root').count(),0,'No separate shared-folder browser');
    const checkSidebar = async () => {
      const active = fm.locator('.fm-place.active');
      assert.equal(await active.count(), 1, 'Only the current folder is highlighted');
      assert.equal(await active.locator('span').last().textContent(), 'Home files');
      assert.equal(await fm.locator('.fm-bookmark-add.active').count(), 0);
      assert.equal(await fm.locator('.fm-places').evaluate(el => el.getBoundingClientRect().width), 230);
      const label = fm.locator('.fm-places').getByText('Manage shared folders', {exact:true});
      assert(await label.evaluate(el => el.scrollWidth <= el.clientWidth), 'Sharing management label fits');
    };
    await checkSidebar();
    await fm.locator('.fm-places').getByText('Home files',{exact:true}).click();
    await row('Sample.txt').waitFor();
    await checkSidebar();
    await fm.locator('.fm-list').press('Control+v');
    await row('Album').waitFor();
    await page.waitForFunction(()=>!document.querySelector('.sf-dialog'));
    assert.deepEqual(fs.readFileSync(path.join(remote,'Album','Disc','Track.bin')),large);
    assert.equal(fs.statSync(path.join(remote,'Album','Empty.txt')).size,0);
    await row('Album').dblclick();await row('Disc').waitFor();
    await checkSidebar();
    await fm.locator('.fm-up').click();await row('Sample.txt').waitFor();
    await fm.locator('.fm-back').click();await row('Disc').waitFor();
    await fm.locator('.fm-up').click();await row('Sample.txt').waitFor();
    await fm.locator('.fm-mkdir').click();
    await page.getByRole('dialog').getByRole('textbox').fill('Created remotely');
    await page.getByRole('dialog').getByRole('textbox').press('Enter');await row('Created remotely').waitFor();
    await menu(row('Sample.txt'),'✏️ Rename');
    assert.equal(await page.getByRole('dialog').getByRole('textbox').inputValue(),'Sample.txt');
    await page.getByRole('dialog').getByRole('textbox').fill('Renamed.txt');
    await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await row('Renamed.txt').waitFor();
    const beforePreview=requests.length;
    await row('Renamed.txt').dblclick();
    await page.locator('.sf-viewer pre').getByText('Remote preview',{exact:true}).waitFor();
    assert(requests.some(r=>r.url.startsWith(sourceURL+'/pub/shared-files/')&&r.url.includes('/file?')));
    assert(!requests.slice(beforePreview).some(r=>r.url.startsWith(receiverURL+'/api/files/raw')),'Preview bytes go directly to source');
    await page.locator('.sf-viewer').evaluate(el=>el.closest('.fixture-window').remove());
    // Return a whole remote folder to a different local destination.
    const returned=path.join(local,'Returned');fs.mkdirSync(returned);
    await menu(row('Album'),'📋 Copy');
    await page.evaluate(p=>FileManager.openWindow(p),returned);
    const second=page.locator('.fm-container').nth(1);
    await second.locator('.fm-empty').waitFor();await menu(second.locator('.fm-list'),'📋 Paste');
    await second.locator('.fm-entry[data-name="Album"]').waitFor();
    assert.deepEqual(fs.readFileSync(path.join(returned,'Album','Disc','Track.bin')),large);
    // Upload is also direct, including an empty file.
    await fm.locator('.fm-upload-input').setInputFiles({name:'Browser.txt',mimeType:'text/plain',buffer:Buffer.from('Direct upload')});
    await row('Browser.txt').waitFor();assert.equal(fs.readFileSync(path.join(remote,'Browser.txt'),'utf8'),'Direct upload');
    // Conflicts must not merge or overwrite existing destination trees.
    await menu(row('Album'),'📋 Copy');
    await menu(fm.locator('.fm-list'),'📋 Paste');
    await page.getByRole('dialog').getByText(/already exists/).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    assert.deepEqual(fs.readFileSync(path.join(remote,'Album','Disc','Track.bin')),large);
    // Cut removes the remote original only after successful delivery.
    await menu(row('Browser.txt'),'✂️ Cut');
    await menu(second.locator('.fm-list'),'📋 Paste');
    await second.locator('.fm-entry[data-name="Browser.txt"]').waitFor();
    await page.waitForFunction(()=>window._fmClipboard===null);
    assert(!fs.existsSync(path.join(remote,'Browser.txt')));
    assert.equal(fs.readFileSync(path.join(returned,'Browser.txt'),'utf8'),'Direct upload');
    // A failed Cut leaves the original and clipboard available for retry.
    const failUpload=route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({detail:'Simulated transfer failure'})});
    await page.route(receiverURL+'/api/files/upload-chunk',failUpload);
    await menu(row('Renamed.txt'),'✂️ Cut');
    await menu(second.locator('.fm-list'),'📋 Paste');
    await page.getByRole('dialog').getByText(/Simulated transfer failure/).waitFor();
    assert(fs.existsSync(path.join(remote,'Renamed.txt')));
    assert.equal(await page.evaluate(()=>window._fmClipboard.cut),true);
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.unroute(receiverURL+'/api/files/upload-chunk',failUpload);
    // Cancel a pending remote write without removing the local Cut source.
    const cancelled=path.join(local,'Cancel.bin');fs.writeFileSync(cancelled,large);
    let putStarted;
    const putReady=new Promise(resolve=>putStarted=resolve);
    const pendingRoute=async route=>{putStarted();await new Promise(resolve=>setTimeout(resolve,1000));await route.abort().catch(()=>{});};
    await page.route(sourceURL+'/pub/shared-files/**/uploads/*',async route=>{
      if(route.request().method()==='PUT')return pendingRoute(route);
      return route.continue();
    });
    await page.evaluate(src=>{window._fmClipboard={paths:[src],cut:true};},cancelled);
    await menu(fm.locator('.fm-list'),'📋 Paste');await putReady;
    await fm.getByRole('button',{name:'Cancel transfer',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    assert(fs.existsSync(cancelled));assert(!fs.existsSync(path.join(remote,'Cancel.bin')));
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.unroute(sourceURL+'/pub/shared-files/**/uploads/*');
    // Cancellation and recursive deletion.
    await menu(row('Album'),'🗑️ Delete');await page.getByRole('dialog').press('Escape');assert(fs.existsSync(path.join(remote,'Album')));
    await menu(row('Album'),'🗑️ Delete');await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();
    await row('Album').waitFor({state:'detached'});assert(!fs.existsSync(path.join(remote,'Album')));
    assert(fs.existsSync(path.join(local,'Album','Disc','Track.bin')),'Copy preserves original');
    assert(!requests.some(r=>r.url.startsWith(receiverURL+'/api/files?')&&decodeURIComponent(r.url).includes('mvmos-share:')),'Virtual paths must never reach the local filesystem API');
    // Do not trust traversal names supplied by a remote server.
    await page.route(sourceURL+'/pub/shared-files/**/list?*',route=>route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':receiverURL},body:JSON.stringify({entries:[{name:'../escape',type:'file',size:1}],permissions:['read']})}));
    await menu(fm.locator('.fm-list'),'🔄 Refresh');
    await fm.getByText(/invalid file list/).waitFor();
    assert.deepEqual(errors,[]);
    console.log('Shared File Manager: same-window browsing, history, mkdir, rename, direct preview/upload, recursive copy both ways, empty/multi-chunk files, conflict handling, Cut success/failure, transfer cancellation, recursive delete and malicious listing rejection passed.');
  } finally {
    if(browser)await browser.close();
    for(const child of servers)child.kill('SIGTERM');
    await Promise.all(servers.map(child=>new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve))));
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exit(1);});
