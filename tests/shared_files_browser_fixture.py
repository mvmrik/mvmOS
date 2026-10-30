"""Temporary HTTP fixture for the shared File Manager browser regression test."""
import os
from pathlib import Path
import pwd
import sys

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, FileResponse
from backend import db, files, shared_files
from backend.auth import get_current_session

root = Path(sys.argv[1])
db.DB_PATH = str(root / 'test.db')
shared_files.init_db()
app = FastAPI()
app.include_router(shared_files.router)
app.include_router(files.router)
app.middleware('http')(shared_files.cors_middleware)
app.dependency_overrides[get_current_session] = lambda: {
    'effective_user': pwd.getpwuid(os.getuid()).pw_name, 'token': 'browser-fixture'}

@app.get('/')
def page():
    return HTMLResponse('''<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/shared-files.css">
    <style>body{overflow:auto;background:#161c22}.fixture-window{position:relative!important;width:1100px;height:650px;margin:12px;display:flex;flex-direction:column}.window-body{flex:1;min-height:0}</style>
    </head><body><script src="/i18n/en.js"></script><script>
    window.t=(key,args={})=>Object.entries(args).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',v),window._i18n[key]||key);
    window.prompt=window.confirm=window.alert=()=>{throw new Error('Native dialogs are unsupported');};
    window.Settings={loadFMPrefs:()=>({showHidden:true,trashDays:0})};
    window.Desktop={initMobileSidebar(){},createWindow(opts){
      const win=document.createElement('section');win.className='fixture-window window';
      const body=document.createElement('div');body.className='window-body';body.tabIndex=0;
      const footer=document.createElement('footer');win.append(body,footer);document.body.append(win);
      setTimeout(()=>opts.onMount(body),0);return{body,footer:{clear(){footer.textContent=''},setContent(html){footer.innerHTML=html}}};
    }};
    </script><script src="/shared-files.js"></script><script src="/filemanager.js"></script></body></html>''')

@app.get('/{path:path}')
def static(path: str):
    frontend = Path(__file__).resolve().parents[1] / 'frontend'
    target = (frontend / path).resolve()
    if target.is_relative_to(frontend) and target.is_file():
        return FileResponse(target)
    return HTMLResponse('Not found', status_code=404)

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=int(sys.argv[2]), log_level='warning')
