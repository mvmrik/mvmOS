"""Exercise Apps Hub's opt-in visibility without loading real platform state."""
import ast
import asyncio
import contextlib
import json
import os
from pathlib import Path
import sqlite3
import types
import tempfile
import unittest
from typing import Optional
from datetime import datetime,timezone
from fastapi import HTTPException
from fastapi.responses import JSONResponse

ROOT=Path(__file__).resolve().parents[1]
NAMES={'can_access_public_app','list_public_apps','set_app_installed_pub','record_app_open'}

class ProfileVisibility(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        fixture = Path(self.temp.name)
        (fixture / 'backend').mkdir()
        (fixture / 'apps/tesla').mkdir(parents=True)
        (fixture / 'apps/tesla/manifest.json').write_text(json.dumps({'public_profile_access': True}))
        self.grants={'owner':True,'friend':True}
        self.hook=types.SimpleNamespace(_can_access_public=lambda uid:self.grants.get(uid,False))
        self.db=sqlite3.connect(':memory:');self.db.row_factory=sqlite3.Row
        self.db.execute('CREATE TABLE app_usage(user_id TEXT, app_id TEXT, open_count INTEGER,last_opened_at TEXT, PRIMARY KEY(user_id,app_id))')
        self.shelf=[]
        ns={'__file__':str(fixture/'backend/apphub.py'),'os':os,'json':json,'Optional':Optional,
            'HTTPException':HTTPException,'JSONResponse':JSONResponse,'datetime':datetime,'timezone':timezone,
            'Header':lambda **kw:None,'InstalledBody':object,
            '_load_app_api':lambda app:self.hook,'_confine_app':lambda app:contextlib.nullcontext(),
            '_detect_public_apps':lambda:['tesla','example'],'is_app_public':lambda app:True,
            '_public_names':lambda:{},'_CORE_APP_META':{},'icon_image':lambda app,m:None,
            'get_pub_session':lambda token:{'id':token} if token in ('owner','friend','stranger') else None,
            'get_user_apps':lambda uid:{'tesla':True,'example':True},'_db':lambda:self.db,
            'set_user_app':lambda uid,app,installed:self.shelf.append((uid,app,installed))}
        tree=ast.parse((ROOT/'backend/apphub.py').read_text());functions=[]
        for node in tree.body:
            if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name in NAMES:
                node.decorator_list=[];functions.append(node)
        exec(compile(ast.Module(body=functions,type_ignores=[]),str(ROOT/'backend/apphub.py'),'exec'),ns)
        self.ns=ns

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def call(self,name,*args):return asyncio.run(self.ns[name](*args))

    def apps(self,user):return json.loads(self.call('list_public_apps',user).body)

    def test_catalogue_hides_restricted_app_from_anonymous_and_unshared_even_if_shelved(self):
        for user in (None,'stranger'):
            self.assertNotIn('tesla',[r['id'] for r in self.apps(user)])
            self.assertIn('example',[r['id'] for r in self.apps(user)])
        for user in ('owner','friend'):
            self.assertIn('tesla',[r['id'] for r in self.apps(user)])
        self.grants.pop('friend')
        self.assertNotIn('tesla',[r['id'] for r in self.apps('friend')])

    def test_shelf_and_open_endpoints_cannot_bypass_visibility(self):
        body=types.SimpleNamespace(installed=True)
        for name,args in [('set_app_installed_pub',('tesla',body,'stranger')),('record_app_open',('tesla','stranger'))]:
            with self.assertRaises(HTTPException) as error:self.call(name,*args)
            self.assertEqual(error.exception.status_code,404)
        self.assertEqual(self.shelf,[])
        self.call('set_app_installed_pub','tesla',body,'friend');self.call('record_app_open','tesla','friend')
        self.assertEqual(self.shelf,[('friend','tesla',True)])
        self.assertEqual(self.db.execute('SELECT user_id FROM app_usage').fetchone()[0],'friend')

    def test_missing_or_failing_hook_denies_but_unrestricted_apps_are_unchanged(self):
        check=self.ns['can_access_public_app']
        self.ns['_load_app_api']=lambda app:None
        self.assertFalse(check('tesla','owner',{'public_profile_access':True}))
        self.hook._can_access_public=lambda uid:(_ for _ in ()).throw(RuntimeError('test'))
        self.ns['_load_app_api']=lambda app:self.hook
        self.assertFalse(check('tesla','owner',{'public_profile_access':True}))
        self.assertTrue(check('example',None,{}))
        self.assertFalse(check('tesla',None,{'public_profile_access':True}))
