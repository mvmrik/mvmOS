"""Revocable, origin-bound folder grants and direct browser file transfers.

The receiving server stores a private reference. It never fetches the remote URL
or proxies file bytes. The source executes filesystem operations as the sharer.
"""
import asyncio
import base64
import hashlib
import hmac
import json
import mimetypes
import os
from pathlib import Path
import secrets
import subprocess
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from .auth import get_current_session
from .db import get_conn
from .shared_files_worker import parts as relative_parts

router = APIRouter()
PREFIX = '/pub/shared-files/v1'
_WORKER = Path(__file__).with_name('shared_files_worker.py').read_text()
_CHUNK = 4 * 1024 * 1024
_PERMISSIONS = {'read', 'upload', 'edit', 'delete'}


def init_db():
    with get_conn() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS file_folder_grants (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
            root TEXT NOT NULL, device INTEGER NOT NULL, inode INTEGER NOT NULL,
            recipient TEXT NOT NULL, permissions TEXT NOT NULL,
            token_hash TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS file_remote_folders (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
            origin TEXT NOT NULL, grant_id TEXT NOT NULL, secret TEXT NOT NULL,
            created REAL NOT NULL, UNIQUE(owner, origin, grant_id));
        CREATE TABLE IF NOT EXISTS file_remote_uploads (
            id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, path TEXT NOT NULL,
            size INTEGER NOT NULL, offset INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL);
        ''')


def origin_url(value):
    try:
        u = urlsplit(value.strip())
        port = u.port
        if (u.scheme not in ('https', 'http') or not u.hostname or u.username or u.password
                or u.path not in ('', '/') or u.query or u.fragment):
            raise ValueError()
        if u.scheme == 'http' and u.hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError()
        host = u.hostname.lower().encode('idna').decode()
        if ':' in host:
            host = '[' + host + ']'
        if port and port != (443 if u.scheme == 'https' else 80):
            host += ':' + str(port)
        return u.scheme + '://' + host
    except (ValueError, UnicodeError, AttributeError):
        raise HTTPException(400, 'Use an HTTPS server address without a path')


def _owner(session):
    # Sharing never inherits a temporary administrator key from File Manager.
    return session['effective_user']


def _local_write(request):
    # A custom header prevents cross-site form submissions with session cookies.
    if request.headers.get('x-mvm-shared-files') != '1':
        raise HTTPException(403, 'Same-origin request required')


def _grant(grant_id):
    with get_conn() as c:
        row = c.execute('SELECT * FROM file_folder_grants WHERE id=?', (grant_id,)).fetchone()
    if not row:
        raise HTTPException(410, 'Sharing has been revoked or does not exist')
    return dict(row)


def _authorize(grant_id, request, permission=None):
    row = _grant(grant_id)
    header = request.headers.get('authorization', '')
    token = header[7:] if header.startswith('Bearer ') else ''
    if not token or not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), row['token_hash']):
        raise HTTPException(401, 'Invalid folder access key')
    origin = request.headers.get('origin')
    if origin and origin != row['recipient']:
        raise HTTPException(403, 'This folder is shared with another server')
    if permission and permission not in json.loads(row['permissions']):
        raise HTTPException(403, 'This operation is not allowed for this shared folder')
    return row


def grant_identity(grant_id: str, request: Request):
    return _authorize(grant_id, request)


def file_identity(grant_id: str, request: Request, ticket: str):
    return _ticket(grant_id, ticket, request)


def _command(row, op, **params):
    data = {**params, 'root': row['root'], 'op': op,
            'device': row.get('device'), 'inode': row.get('inode')}
    command = ['python3', '-c', _WORKER]
    if row['owner'] != 'root':
        command = ([] if os.geteuid() == 0 else ['sudo']) + ['runuser', '-u', row['owner'], '--'] + command
    return command, json.dumps(data)


def _work(row, op, **params):
    command, data = _command(row, op, **params)
    try:
        r = subprocess.run(command, input=data, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, 'Filesystem operation timed out')
    if r.returncode:
        try:
            error = json.loads(r.stderr)['error']
        except (ValueError, KeyError):
            error = 'Folder is unavailable or permission was denied'
        raise HTTPException(400, error[:300])
    return json.loads(r.stdout)


def _metadata(row):
    return {'id': row['id'], 'name': row['name'], 'permissions': json.loads(row['permissions']),
            'recipient': row['recipient'], 'protocol': 1}


class ShareBody(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    name: str = Field(min_length=1, max_length=120)
    recipient: str
    permissions: list[str] = ['read']


@router.get('/api/files/sharing')
def sharing_list(session=Depends(get_current_session)):
    with get_conn() as c:
        outgoing = [dict(r) for r in c.execute(
            'SELECT id,name,root,recipient,permissions,created FROM file_folder_grants WHERE owner=? ORDER BY created',
            (_owner(session),))]
        incoming = [dict(r) for r in c.execute(
            'SELECT id,name,origin,grant_id,created FROM file_remote_folders WHERE owner=? ORDER BY created',
            (_owner(session),))]
    for row in outgoing:
        row['permissions'] = json.loads(row['permissions'])
    return {'outgoing': outgoing, 'incoming': incoming}


@router.post('/api/files/sharing')
def sharing_create(body: ShareBody, request: Request, session=Depends(get_current_session)):
    _local_write(request)
    permissions = sorted(set(body.permissions))
    if not set(permissions) <= _PERMISSIONS:
        raise HTTPException(400, 'Invalid permissions')
    if not body.name.strip():
        raise HTTPException(400, 'A folder name is required')
    root = os.path.abspath(body.path)
    row = {'owner': _owner(session), 'root': root}
    probe = _work(row, 'probe')
    recipient = origin_url(body.recipient)
    token = secrets.token_urlsafe(32)
    grant_id = secrets.token_hex(16)
    with get_conn() as c:
        c.execute('INSERT INTO file_folder_grants VALUES (?,?,?,?,?,?,?,?,?,?)',
                  (grant_id, row['owner'], body.name.strip(), root, probe['device'], probe['inode'],
                   recipient, json.dumps(permissions), hashlib.sha256(token.encode()).hexdigest(), time.time()))
    return {'id': grant_id, 'secret': token, 'name': body.name.strip(), 'recipient': recipient}


@router.delete('/api/files/sharing/{grant_id}')
def sharing_revoke(grant_id: str, request: Request, session=Depends(get_current_session)):
    _local_write(request)
    row = _grant(grant_id)
    if row['owner'] != _owner(session):
        raise HTTPException(404, 'Not found')
    # Delete first, so no new request can use this grant while cleanup runs.
    with get_conn() as c:
        uploads = [dict(r) for r in c.execute('SELECT * FROM file_remote_uploads WHERE grant_id=?', (grant_id,))]
        c.execute('DELETE FROM file_folder_grants WHERE id=?', (grant_id,))
        c.execute('DELETE FROM file_remote_uploads WHERE grant_id=?', (grant_id,))
    for upload in uploads:
        try:
            _work(row, 'cancel', path=upload['path'], upload_id=upload['id'])
        except HTTPException:
            pass
    return {'ok': True}


class ConnectBody(BaseModel):
    origin: str
    grant_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    secret: str = Field(min_length=32, max_length=128)
    name: str = Field(min_length=1, max_length=120)


@router.post('/api/files/remote-folders')
def remote_connect(body: ConnectBody, request: Request, session=Depends(get_current_session)):
    _local_write(request)
    origin = origin_url(body.origin)
    folder_id = secrets.token_hex(16)
    with get_conn() as c:
        existing = c.execute('SELECT id FROM file_remote_folders WHERE owner=? AND origin=? AND grant_id=?',
                             (_owner(session), origin, body.grant_id)).fetchone()
        if existing:
            folder_id = existing['id']
            c.execute('UPDATE file_remote_folders SET name=?,secret=? WHERE id=?', (body.name, body.secret, folder_id))
        else:
            c.execute('INSERT INTO file_remote_folders VALUES (?,?,?,?,?,?,?)',
                      (folder_id, _owner(session), body.name, origin, body.grant_id, body.secret, time.time()))
    return {'id': folder_id}


@router.get('/api/files/remote-folders/{folder_id}')
def remote_details(folder_id: str, session=Depends(get_current_session)):
    with get_conn() as c:
        row = c.execute('SELECT * FROM file_remote_folders WHERE id=? AND owner=?', (folder_id, _owner(session))).fetchone()
    if not row:
        raise HTTPException(404, 'Not found')
    return JSONResponse(dict(row), headers={'Cache-Control': 'private, no-store'})


@router.delete('/api/files/remote-folders/{folder_id}')
def remote_disconnect(folder_id: str, request: Request, session=Depends(get_current_session)):
    _local_write(request)
    with get_conn() as c:
        c.execute('DELETE FROM file_remote_folders WHERE id=? AND owner=?', (folder_id, _owner(session)))
    return {'ok': True}


async def cors_middleware(request, call_next):
    if not request.url.path.startswith(PREFIX + '/'):
        response = await call_next(request)
        if request.url.path.startswith(('/api/files/sharing', '/api/files/remote-folders')):
            response.headers['Cache-Control'] = 'private, no-store'
        return response
    grant_id = request.url.path[len(PREFIX) + 1:].split('/')[0]
    origin = request.headers.get('origin')
    try:
        grant = _grant(grant_id)
    except HTTPException:
        grant = None
    allowed = bool(grant and origin == grant['recipient'])
    if request.method == 'OPTIONS':
        response = Response(status_code=204 if allowed else 403)
    else:
        response = await call_next(request)
    response.headers['Cache-Control'] = 'private, no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    if allowed:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Methods'] = 'GET, HEAD, POST, PUT, DELETE, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, Range, X-Upload-Offset'
        response.headers['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Accept-Ranges, Content-Disposition'
        response.headers['Access-Control-Max-Age'] = '300'
    return response


@router.get(PREFIX + '/{grant_id}', dependencies=[Depends(grant_identity)])
def remote_info(grant_id: str, request: Request):
    row = _authorize(grant_id, request)
    _work(row, 'probe')
    return _metadata(row)


@router.get(PREFIX + '/{grant_id}/list', dependencies=[Depends(grant_identity)])
def remote_list(grant_id: str, request: Request, path: str = ''):
    row = _authorize(grant_id, request)
    return {**_work(row, 'list', path=path), 'permissions': json.loads(row['permissions'])}


class OperationBody(BaseModel):
    path: str = Field(max_length=4096)
    new_name: str = Field(default='', max_length=255)


@router.post(PREFIX + '/{grant_id}/operations/{operation}', dependencies=[Depends(grant_identity)])
def remote_operation(grant_id: str, operation: str, body: OperationBody, request: Request):
    permission = {'mkdir': 'upload', 'rename': 'edit', 'delete': 'delete'}.get(operation)
    if permission is None:
        raise HTTPException(404, 'Unknown operation')
    row = _authorize(grant_id, request, permission)
    return _work(row, operation, path=body.path, new_name=body.new_name)


def _encode(data):
    return base64.urlsafe_b64encode(data).decode().rstrip('=')


def _decode(data):
    return base64.urlsafe_b64decode(data + '=' * (-len(data) % 4))


@router.post(PREFIX + '/{grant_id}/ticket', dependencies=[Depends(grant_identity)])
def file_ticket(grant_id: str, body: OperationBody, request: Request):
    row = _authorize(grant_id, request, 'read')
    _work(row, 'stat', path=body.path)
    payload = _encode(json.dumps({'path': body.path, 'expires': int(time.time()) + 3600}, separators=(',', ':')).encode())
    signature = _encode(hmac.new(row['token_hash'].encode(), payload.encode(), hashlib.sha256).digest())
    return {'ticket': payload + '.' + signature, 'expires_in': 3600}


def _ticket(grant_id, ticket, request):
    row = _grant(grant_id)
    try:
        payload, signature = ticket.split('.')
        expected = _encode(hmac.new(row['token_hash'].encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(expected, signature):
            raise ValueError()
        data = json.loads(_decode(payload))
        if data['expires'] < time.time() or 'read' not in json.loads(row['permissions']):
            raise ValueError()
        if request.headers.get('origin') and request.headers['origin'] != row['recipient']:
            raise ValueError()
        return row, data['path']
    except (ValueError, KeyError, TypeError):
        raise HTTPException(403, 'File access expired; open the file again')


def _range(value, size):
    if not value:
        return 0, size - 1, 200
    try:
        if not value.startswith('bytes=') or ',' in value:
            raise ValueError()
        first, last = value[6:].split('-')
        if first:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        else:
            length = int(last)
            if length <= 0:
                raise ValueError()
            start, end = max(0, size - length), size - 1
        if start < 0 or start >= size or end < start:
            raise ValueError()
        return start, end, 206
    except ValueError:
        raise HTTPException(416, 'Invalid byte range', headers={'Content-Range': f'bytes */{size}'})


@router.api_route(PREFIX + '/{grant_id}/file', methods=['GET', 'HEAD'], dependencies=[Depends(file_identity)])
def remote_file(grant_id: str, request: Request, ticket: str, download: bool = False):
    row, path = _ticket(grant_id, ticket, request)
    st = _work(row, 'stat', path=path)
    start, end, status = _range(request.headers.get('range'), st['size'])
    length = max(0, end - start + 1)
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    # Never execute remote HTML, SVG or scripts in either server's origin.
    inline = mime.startswith(('audio/', 'video/')) or mime in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'text/plain')
    from urllib.parse import quote
    disposition = 'attachment' if download or not inline else 'inline'
    headers = {'Content-Length': str(length), 'Accept-Ranges': 'bytes',
               'Content-Disposition': f"{disposition}; filename*=UTF-8''{quote(os.path.basename(path), safe='')}",
               'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'private, no-store',
               'X-Mvm-No-Public-Chrome': '1'}
    if status == 206:
        headers['Content-Range'] = f"bytes {start}-{end}/{st['size']}"
    if request.method == 'HEAD':
        return Response(status_code=status, media_type=mime, headers=headers)

    def stream():
        command, data = _command(row, 'read', path=path, offset=start, length=length)
        proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            proc.stdin.write(data.encode())
            proc.stdin.close()
            while True:
                chunk = proc.stdout.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            proc.stdout.close()
            if proc.poll() is None:
                proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
    return StreamingResponse(stream(), status_code=status, media_type=mime, headers=headers)


class UploadBody(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    size: int = Field(ge=0, le=1024 ** 4)


@router.post(PREFIX + '/{grant_id}/uploads', dependencies=[Depends(grant_identity)])
def upload_start(grant_id: str, body: UploadBody, request: Request):
    try:
        relative_parts(body.path)
    except ValueError:
        raise HTTPException(400, 'Invalid relative path')
    row = _authorize(grant_id, request, 'upload')
    with get_conn() as c:
        stale = [dict(r) for r in c.execute('SELECT * FROM file_remote_uploads WHERE grant_id=? AND created<?', (grant_id, time.time() - 86400))]
        for upload in stale:
            try:
                _work(row, 'cancel', path=upload['path'], upload_id=upload['id'])
            except HTTPException:
                pass
            c.execute('DELETE FROM file_remote_uploads WHERE id=?', (upload['id'],))
    # Bound simultaneous incomplete transfers. No bytes are accepted here.
    with get_conn() as c:
        count = c.execute('SELECT count(*) FROM file_remote_uploads WHERE grant_id=?', (grant_id,)).fetchone()[0]
        if count >= 20:
            raise HTTPException(409, 'Too many unfinished uploads; cancel an upload first')
        upload_id = secrets.token_hex(16)
        c.execute('INSERT INTO file_remote_uploads(id,grant_id,path,size,created) VALUES (?,?,?,?,?)',
                  (upload_id, grant_id, body.path, body.size, time.time()))
    return {'id': upload_id, 'chunk_size': _CHUNK}


@router.put(PREFIX + '/{grant_id}/uploads/{upload_id}', dependencies=[Depends(grant_identity)])
async def upload_chunk(grant_id: str, upload_id: str, request: Request):
    row = await asyncio.to_thread(_authorize, grant_id, request, 'upload')
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > _CHUNK:
            raise HTTPException(413, 'Upload chunk is too large')
    try:
        offset = int(request.headers.get('x-upload-offset', '-1'))
    except ValueError:
        raise HTTPException(400, 'Invalid offset')

    def store():
        # Serialize chunks and cancellation for this transfer, including across workers.
        with get_conn() as c:
            c.execute('BEGIN IMMEDIATE')
            upload = c.execute('SELECT * FROM file_remote_uploads WHERE id=? AND grant_id=?', (upload_id, grant_id)).fetchone()
            if not upload:
                raise HTTPException(404, 'Upload not found')
            if offset != upload['offset'] or offset + len(data) > upload['size']:
                raise HTTPException(409, 'Upload offset mismatch')
            _authorize(grant_id, request, 'upload')
            final = offset + len(data) == upload['size']
            _work(row, 'upload', path=upload['path'], upload_id=upload_id, offset=offset,
                  data=base64.b64encode(data).decode(), final=final)
            if final:
                c.execute('DELETE FROM file_remote_uploads WHERE id=?', (upload_id,))
            else:
                c.execute('UPDATE file_remote_uploads SET offset=? WHERE id=?', (offset + len(data), upload_id))
            return {'ok': True, 'done': final, 'offset': offset + len(data)}
    return await asyncio.to_thread(store)


@router.delete(PREFIX + '/{grant_id}/uploads/{upload_id}', dependencies=[Depends(grant_identity)])
def upload_cancel(grant_id: str, upload_id: str, request: Request):
    row = _authorize(grant_id, request, 'upload')
    with get_conn() as c:
        c.execute('BEGIN IMMEDIATE')
        upload = c.execute('SELECT * FROM file_remote_uploads WHERE id=? AND grant_id=?', (upload_id, grant_id)).fetchone()
        if upload:
            _work(row, 'cancel', path=upload['path'], upload_id=upload_id)
            c.execute('DELETE FROM file_remote_uploads WHERE id=?', (upload_id,))
    return {'ok': True}
