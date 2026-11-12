"""Isolated filesystem worker. Executed as the sharing Linux user, never imported.

Every path component is opened relative to an existing directory descriptor with
O_NOFOLLOW. A symlink swap cannot escape the shared root, including during writes.
"""
import base64
import datetime
import json
import os
import stat
import sys


def parts(path):
    if not isinstance(path, str) or path.startswith('/') or '\x00' in path:
        raise ValueError('Invalid relative path')
    result = path.split('/') if path else []
    if any(p in ('', '.', '..') or p.startswith('.mvmos-share-upload-') for p in result):
        raise ValueError('Invalid relative path')
    return result


def directory(start, components):
    fd = os.dup(start)
    try:
        for name in components:
            nxt = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        return fd
    except BaseException:
        os.close(fd)
        raise


def main(body):
    root = body['root']
    if not os.path.isabs(root):
        raise ValueError('Invalid root')
    slash = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        fd = directory(slash, [p for p in root.split('/') if p])
    finally:
        os.close(slash)
    try:
        root_stat = os.fstat(fd)
        if body.get('device') is not None and [root_stat.st_dev, root_stat.st_ino] != [body['device'], body['inode']]:
            raise PermissionError('Shared folder has changed; share it again')
        if body['op'] == 'probe':
            # Verify listing as the owner before publishing the invitation.
            os.listdir(fd)
            return {'device': root_stat.st_dev, 'inode': root_stat.st_ino}
        if [root_stat.st_dev, root_stat.st_ino] != [body['device'], body['inode']]:
            raise PermissionError('Shared folder has changed; share it again')
        names = parts(body.get('path', ''))
        op = body['op']
        if op == 'list':
            target = directory(fd, names)
            try:
                entries = []
                for name in sorted(os.listdir(target)):
                    if name.startswith('.mvmos-share-upload-'):
                        continue
                    st = os.stat(name, dir_fd=target, follow_symlinks=False)
                    if not (stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode)):
                        continue
                    entries.append({'name': name, 'type': 'dir' if stat.S_ISDIR(st.st_mode) else 'file',
                                    'size': st.st_size, 'modified': datetime.datetime.fromtimestamp(st.st_mtime).isoformat()})
                    if len(entries) > 10000:
                        raise ValueError('Folder contains more than 10000 entries')
                return {'entries': entries}
            finally:
                os.close(target)
        if not names:
            raise PermissionError('The shared root cannot be modified or downloaded')
        parent = directory(fd, names[:-1])
        name = names[-1]
        try:
            if op in ('stat', 'read'):
                file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
                with os.fdopen(file_fd, 'rb') as f:
                    st = os.fstat(f.fileno())
                    if not stat.S_ISREG(st.st_mode):
                        raise PermissionError('Not a regular file')
                    if op == 'stat':
                        return {'size': st.st_size, 'modified': st.st_mtime}
                    f.seek(body.get('offset', 0))
                    remaining = body['length']
                    while remaining > 0:
                        chunk = f.read(min(1024 * 1024, remaining))
                        if not chunk:
                            break
                        sys.stdout.buffer.write(chunk)
                        remaining -= len(chunk)
                    return None
            if op == 'mkdir':
                os.mkdir(name, mode=0o755, dir_fd=parent)
                # mkdir honours the umask; make the mode explicit so other users can enter the folder.
                os.chmod(name, 0o755, dir_fd=parent)
            elif op == 'delete':
                st = os.stat(name, dir_fd=parent, follow_symlinks=False)
                if stat.S_ISDIR(st.st_mode):
                    os.rmdir(name, dir_fd=parent)  # only empty folders
                elif stat.S_ISREG(st.st_mode):
                    os.unlink(name, dir_fd=parent)
                else:
                    raise PermissionError('Symlinks and special files cannot be modified')
            elif op == 'rename':
                st = os.stat(name, dir_fd=parent, follow_symlinks=False)
                if not (stat.S_ISREG(st.st_mode) or stat.S_ISDIR(st.st_mode)):
                    raise PermissionError('Symlinks and special files cannot be modified')
                new_parts = parts(body['new_name'])
                if len(new_parts) != 1:
                    raise ValueError('Invalid name')
                # renameat2 RENAME_NOREPLACE prevents races and silent overwrites.
                import ctypes
                libc = ctypes.CDLL(None, use_errno=True)
                if libc.renameat2(parent, os.fsencode(name), parent, os.fsencode(new_parts[0]), 1) != 0:
                    err = ctypes.get_errno()
                    raise OSError(err, os.strerror(err))
            elif op in ('upload', 'cancel'):
                upload_id = body['upload_id']
                if len(upload_id) != 32 or any(c not in '0123456789abcdef' for c in upload_id):
                    raise ValueError('Invalid upload')
                temp = '.mvmos-share-upload-' + upload_id
                if op == 'cancel':
                    try:
                        os.unlink(temp, dir_fd=parent)
                    except FileNotFoundError:
                        pass
                    return {'ok': True}
                offset = body['offset']
                flags = os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK
                flags |= os.O_CREAT | os.O_EXCL if offset == 0 else os.O_APPEND
                file_fd = os.open(temp, flags, 0o600, dir_fd=parent)
                with os.fdopen(file_fd, 'wb') as f:
                    st = os.fstat(f.fileno())
                    if not stat.S_ISREG(st.st_mode) or st.st_size != offset:
                        raise ValueError('Upload offset mismatch')
                    f.write(base64.b64decode(body['data'], validate=True))
                    f.flush()
                    if body['final']:
                        # Created private (0600); publish with normal permissions so other
                        # programs on the sharing server (media servers, Samba) can read it.
                        os.fchmod(f.fileno(), 0o644)
                        os.fsync(f.fileno())
                if body['final']:
                    # Hard link creates the destination only if it does not exist.
                    os.link(temp, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
                    os.unlink(temp, dir_fd=parent)
            else:
                raise ValueError('Unknown operation')
            return {'ok': True}
        finally:
            os.close(parent)
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        result = main(json.load(sys.stdin))
        if result is not None:
            print(json.dumps(result))
    except (OSError, ValueError) as exc:
        print(json.dumps({'error': str(exc)}), file=sys.stderr)
        sys.exit(1)
