"""Folder sharing authorization, confinement and direct transfer contract."""
import hashlib
import os
from pathlib import Path
import pwd
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend import shared_files as sf
from backend.auth import get_current_session


class SharedFilesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'shared'
        self.root.mkdir()
        (self.root / 'song.mp3').write_bytes(b'0123456789')
        self.outside = Path(self.temp.name) / 'private.txt'
        self.outside.write_text('PRIVATE')
        (self.root / 'escape').symlink_to(self.outside)
        (self.root / 'escape-dir').symlink_to(self.root.parent, target_is_directory=True)
        self.username = pwd.getpwuid(os.geteuid()).pw_name
        self.db_path = str(Path(self.temp.name) / 'test.db')
        def connection():
            c = sqlite3.connect(self.db_path)
            c.row_factory = sqlite3.Row
            return c
        self.conn = connection
        self.mock = patch.object(sf, 'get_conn', connection)
        self.mock.start()
        self.addCleanup(self.mock.stop)
        sf.init_db()
        self.app = FastAPI()
        self.app.include_router(sf.router)
        self.app.middleware('http')(sf.cors_middleware)
        self.session = {'effective_user': self.username, 'token': 'test'}
        self.app.dependency_overrides[get_current_session] = lambda: self.session
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.local = {'X-Mvm-Shared-Files': '1'}
        self.recipient = 'https://receiver.example'
        self.grant = self.create(['read', 'upload', 'edit', 'delete'])
        self.headers = {'Authorization': 'Bearer ' + self.grant['secret'], 'Origin': self.recipient}
        self.base = sf.PREFIX + '/' + self.grant['id']

    def create(self, permissions):
        r = self.client.post('/api/files/sharing', headers=self.local, json={
            'path': str(self.root), 'name': 'Shared music', 'recipient': self.recipient, 'permissions': permissions})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def ticket(self, path='song.mp3'):
        r = self.client.post(self.base + '/ticket', headers=self.headers, json={'path': path})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['ticket']

    def test_cors_requires_exact_recipient_and_never_cookies(self):
        for origin, code in [(self.recipient, 204), ('https://evil.example', 403), ('null', 403)]:
            with self.subTest(origin=origin):
                r = self.client.options(self.base + '/list', headers={'Origin': origin,
                    'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization'})
                self.assertEqual(r.status_code, code)
                self.assertNotIn('Access-Control-Allow-Credentials', r.headers)
                self.assertEqual(r.headers.get('Access-Control-Allow-Origin'), origin if code == 204 else None)
        self.assertEqual(self.client.get(self.base + '/list').status_code, 401)
        r = self.client.get(self.base + '/list', headers={**self.headers, 'Origin': 'https://evil.example'})
        self.assertEqual(r.status_code, 403)
        r = self.client.get(self.base + '/list', headers={**self.headers, 'Authorization': 'Bearer wrong'})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.headers['Access-Control-Allow-Origin'], self.recipient)

    def test_streaming_ranges_head_empty_and_revocation(self):
        ticket = self.ticket()
        url = self.base + '/file?ticket=' + ticket
        r = self.client.get(url, headers={'Range': 'bytes=2-5', 'Origin': self.recipient})
        self.assertEqual((r.status_code, r.content), (206, b'2345'))
        self.assertEqual(r.headers['Content-Range'], 'bytes 2-5/10')
        self.assertEqual(self.client.get(url, headers={'Range': 'bytes=-3'}).content, b'789')
        self.assertEqual(self.client.get(url, headers={'Range': 'bytes=20-'}).status_code, 416)
        r = self.client.head(url)
        self.assertEqual(r.headers['Content-Length'], '10')
        self.assertEqual(r.content, b'')
        self.assertEqual(self.client.get(url).content, b'0123456789')
        self.assertEqual(self.client.get(url + 'x').status_code, 403)
        with patch.object(sf.time, 'time', return_value=time.time() + 3700):
            self.assertEqual(self.client.get(url).status_code, 403)
        self.client.delete('/api/files/sharing/' + self.grant['id'], headers=self.local)
        self.assertEqual(self.client.get(url).status_code, 410)
        self.assertEqual(self.client.get(self.base + '/list', headers=self.headers).status_code, 410)
        (self.root / 'empty.mp3').touch()
        self.grant = self.create(['read'])
        self.base = sf.PREFIX + '/' + self.grant['id']
        self.headers['Authorization'] = 'Bearer ' + self.grant['secret']
        r = self.client.get(self.base + '/file?ticket=' + self.ticket('empty.mp3'))
        self.assertEqual((r.status_code, r.content), (200, b''))

    def test_traversal_symlinks_and_root_replacement_are_rejected(self):
        r = self.client.get(self.base + '/list', headers=self.headers)
        self.assertEqual([e['name'] for e in r.json()['entries']], ['song.mp3'])
        for path in ['../private.txt', '/etc/passwd', 'escape', 'escape-dir/private.txt', 'x/../../private.txt']:
            with self.subTest(path=path):
                r = self.client.post(self.base + '/ticket', headers=self.headers, json={'path': path})
                self.assertEqual(r.status_code, 400, r.text)
        for path in ['escape', 'escape-dir']:
            r = self.client.post(self.base + '/operations/rename', headers=self.headers, json={'path': path, 'new_name': 'bad'})
            self.assertEqual(r.status_code, 400)
        for operation in ['mkdir', 'rename', 'delete']:
            r = self.client.post(self.base + '/operations/' + operation, headers=self.headers,
                                 json={'path': '', 'new_name': 'bad'})
            self.assertEqual(r.status_code, 400)
        self.root.rename(self.root.with_name('original'))
        self.root.mkdir()
        self.assertEqual(self.client.get(self.base + '/list', headers=self.headers).status_code, 400)
        self.assertEqual(self.client.get(self.base, headers=self.headers).status_code, 400)

    def test_permissions_are_independent_and_checked_at_source(self):
        grant = self.create([])
        base = sf.PREFIX + '/' + grant['id']
        headers = {**self.headers, 'Authorization': 'Bearer ' + grant['secret']}
        self.assertEqual(self.client.get(base + '/list', headers=headers).status_code, 200)
        for operation in ['mkdir', 'rename', 'delete']:
            self.assertEqual(self.client.post(base + '/operations/' + operation, headers=headers,
                json={'path': 'song.mp3', 'new_name': 'new.mp3'}).status_code, 403)
        self.assertEqual(self.client.post(base + '/ticket', headers=headers, json={'path': 'song.mp3'}).status_code, 403)
        self.assertEqual(self.client.post(base + '/uploads', headers=headers, json={'path': 'new', 'size': 3}).status_code, 403)
        self.assertEqual((self.root / 'song.mp3').read_bytes(), b'0123456789')

    def test_upload_chunks_no_overwrite_cancel_and_operations(self):
        def start(path, size):
            r = self.client.post(self.base + '/uploads', headers=self.headers, json={'path': path, 'size': size})
            self.assertEqual(r.status_code, 200, r.text)
            return self.base + '/uploads/' + r.json()['id']
        def chunk(url, offset, data):
            return self.client.put(url, headers={**self.headers, 'X-Upload-Offset': str(offset)}, content=data)
        r = self.client.post(self.base + '/uploads', headers=self.headers, json={'path': '../outside', 'size': 3})
        self.assertEqual(r.status_code, 400)
        url = start('new.mp3', 6)
        self.assertEqual(chunk(url, 0, b'abc').status_code, 200)
        self.assertFalse((self.root / 'new.mp3').exists())
        self.assertEqual(chunk(url, 1, b'def').status_code, 409)
        r = chunk(url, 3, b'def')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((self.root / 'new.mp3').read_bytes(), b'abcdef')
        url = start('song.mp3', 3)
        self.assertEqual(chunk(url, 0, b'BAD').status_code, 400)
        self.assertEqual((self.root / 'song.mp3').read_bytes(), b'0123456789')
        self.assertEqual(self.client.delete(url, headers=self.headers).status_code, 200)
        url = start('unfinished', 10)
        self.assertEqual(chunk(url, 0, b'abc').status_code, 200)
        self.assertEqual(self.client.delete(url, headers=self.headers).status_code, 200)
        self.assertFalse(list(self.root.glob('.mvmos-share-upload-*')))
        def operation(op, path, **extra):
            return self.client.post(self.base + '/operations/' + op, headers=self.headers, json={'path': path, **extra})
        self.assertEqual(operation('mkdir', 'folder').status_code, 200)
        self.assertEqual(operation('rename', 'new.mp3', new_name='renamed.mp3').status_code, 200)
        self.assertEqual(operation('rename', 'renamed.mp3', new_name='song.mp3').status_code, 400)
        self.assertEqual(operation('rename', 'renamed.mp3', new_name='../bad').status_code, 400)
        self.assertEqual(operation('delete', 'renamed.mp3').status_code, 200)
        self.assertEqual(operation('delete', 'folder').status_code, 200)
        self.assertEqual(self.outside.read_text(), 'PRIVATE')

    @unittest.skipUnless(os.geteuid() == 0, 'needs root to verify privilege dropping')
    def test_share_runs_as_owner_without_administrator_elevation(self):
        nobody = pwd.getpwnam('nobody')
        os.chmod(self.temp.name, 0o755)
        os.chmod(self.root, 0o777)
        self.session = {'effective_user': 'nobody', 'token': 'test-nobody'}
        self.grant = self.create(['read', 'upload'])
        self.base = sf.PREFIX + '/' + self.grant['id']
        self.headers['Authorization'] = 'Bearer ' + self.grant['secret']
        r = self.client.post(self.base + '/uploads', headers=self.headers, json={'path': 'owned.txt', 'size': 3})
        self.assertEqual(r.status_code, 200, r.text)
        r = self.client.put(self.base + '/uploads/' + r.json()['id'],
                            headers={**self.headers, 'X-Upload-Offset': '0'}, content=b'abc')
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((self.root / 'owned.txt').stat().st_uid, nobody.pw_uid)
        os.chmod(self.root, 0o700)
        r = self.client.post('/api/files/sharing', headers={**self.local, 'X-Admin-Key': 'fake'}, json={
            'path': str(self.root), 'name': 'Denied', 'recipient': self.recipient, 'permissions': ['read']})
        self.assertEqual(r.status_code, 400, r.text)

    def test_receiver_account_isolation_and_csrf(self):
        data = {'origin': 'https://source.example', 'grant_id': self.grant['id'],
                'secret': self.grant['secret'], 'name': 'Home'}
        self.assertEqual(self.client.post('/api/files/remote-folders', json=data).status_code, 403)
        r = self.client.post('/api/files/remote-folders', headers=self.local, json=data)
        self.assertEqual(r.status_code, 200, r.text)
        folder_id = r.json()['id']
        self.assertEqual(self.client.get('/api/files/remote-folders/' + folder_id).json()['secret'], self.grant['secret'])
        with self.conn() as c:
            stored = c.execute('SELECT token_hash FROM file_folder_grants WHERE id=?', (self.grant['id'],)).fetchone()[0]
        self.assertEqual(stored, hashlib.sha256(self.grant['secret'].encode()).hexdigest())
        self.session = {'effective_user': 'different-user', 'token': 'other'}
        self.assertEqual(self.client.get('/api/files/remote-folders/' + folder_id).status_code, 404)
        self.assertEqual(self.client.get('/api/files/sharing').json(), {'incoming': [], 'outgoing': []})
        self.assertEqual(self.client.delete('/api/files/sharing/' + self.grant['id'], headers=self.local).status_code, 404)
        self.client.delete('/api/files/remote-folders/' + folder_id, headers=self.local)
        self.session = {'effective_user': self.username, 'token': 'test'}
        self.assertEqual(self.client.get('/api/files/remote-folders/' + folder_id).status_code, 200)


if __name__ == '__main__':
    unittest.main()
