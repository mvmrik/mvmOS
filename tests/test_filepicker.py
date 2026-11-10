"""Server helpers behind the shared file picker (backend/filepicker.py).

Run: venv/bin/python tests/test_filepicker.py
Everything happens in temporary folders and a temporary database.
"""
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend import filepicker, shared_files  # noqa: E402

SESSION = {"effective_user": "root"}


class ServerFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir="/tmp")
        os.chmod(self.tmp.name, 0o755)
        self.root = os.path.realpath(self.tmp.name)
        self.music = os.path.join(self.root, "music")
        os.mkdir(self.music)
        self.song = os.path.join(self.music, "song.mp3")
        Path(self.song).write_bytes(b"x" * 2048)
        self.other = os.path.join(self.root, "other")
        os.mkdir(self.other)
        Path(self.other, "secret.mp3").write_bytes(b"s")

    def tearDown(self):
        self.tmp.cleanup()

    def resolve(self, path, **kw):
        return filepicker.resolve_server_path(SESSION, path, [self.music], **kw)

    def refused(self, code, *a, **kw):
        with self.assertRaises(HTTPException) as caught:
            self.resolve(*a, **kw)
        self.assertEqual(caught.exception.status_code, code)

    def test_library_listing_opening_and_sidecar_write(self):
        Path(self.music, 'chapter2.mp3').write_bytes(b'abc')
        Path(self.music, 'notes.txt').write_text('notes')
        os.symlink(self.other, os.path.join(self.music, 'escape'))
        entries = filepicker.folder_files('root', self.music, {'.mp3'})
        self.assertEqual({e['rel'] for e in entries}, {'song.mp3', 'chapter2.mp3'})
        handle, size = filepicker.open_server_file('root', self.music, 'chapter2.mp3')
        with handle:
            self.assertEqual(handle.read(), b'abc')
        self.assertEqual(size, 3)
        for rel in ('../other/secret.mp3', 'escape/secret.mp3'):
            with self.assertRaises(HTTPException):
                filepicker.open_server_file('root', self.music, rel)
        target = filepicker.write_beside('root', self.music, 'chapter2.en.srt', b'subtitle')
        self.assertEqual(Path(target).read_bytes(), b'subtitle')
        self.assertIsNone(filepicker.write_beside('root', self.music, '../other/new.srt', b'bad'))
        self.assertFalse(Path(self.other, 'new.srt').exists())

    def test_path_inside_allowed_root(self):
        self.assertEqual(self.resolve(self.song), self.song)
        self.assertEqual(self.resolve(self.music, kind="dir"), self.music)

    def test_outside_roots_and_traversal_are_refused(self):
        self.refused(403, os.path.join(self.other, "secret.mp3"))
        self.refused(403, self.music + "/../other/secret.mp3")
        # A sibling that merely starts with the root's name is not inside it.
        sibling = self.music + "-extra"
        os.mkdir(sibling)
        Path(sibling, "a.mp3").write_bytes(b"a")
        self.refused(403, os.path.join(sibling, "a.mp3"))

    def test_symlink_cannot_leave_the_root(self):
        os.symlink(self.other, os.path.join(self.music, "link"))
        self.refused(403, os.path.join(self.music, "link", "secret.mp3"))

    def test_invalid_missing_and_wrong_kind(self):
        self.refused(400, "relative/song.mp3")
        self.refused(400, "")
        self.refused(400, self.music + "/a\0.mp3")
        self.refused(404, os.path.join(self.music, "nope.mp3"))
        self.refused(404, self.music)                       # a folder is not a file
        self.refused(404, self.song, kind="dir")

    def test_type_and_size_limits(self):
        self.refused(400, self.song, extensions={".flac"})
        self.assertEqual(self.resolve(self.song, extensions={".MP3"}), self.song)
        self.refused(413, self.song, max_bytes=1024)

    def test_home_root_expands(self):
        home = os.path.realpath(os.path.expanduser("~root"))
        self.assertEqual(filepicker.expand_roots(SESSION, ["~"]), [home])
        with self.assertRaises(ValueError):
            filepicker.expand_roots(SESSION, ["relative"])

    def test_copy_reads_the_file_and_enforces_the_limit(self):
        target = os.path.join(self.root, "copy.bin")
        self.assertEqual(filepicker.copy_server_file(SESSION, self.song, target), 2048)
        self.assertEqual(Path(target).read_bytes(), b"x" * 2048)
        with self.assertRaises(HTTPException) as caught:
            filepicker.copy_server_file(SESSION, self.song, os.path.join(self.root, "small.bin"), max_bytes=100)
        self.assertEqual(caught.exception.status_code, 413)

    @unittest.skipUnless(os.geteuid() == 0, "needs root to drop privileges")
    def test_reads_run_as_the_signed_in_user(self):
        import pwd
        try:
            pwd.getpwnam("nobody")
        except KeyError:
            self.skipTest("no nobody user")
        private = os.path.join(self.music, "private.mp3")
        Path(private).write_bytes(b"p")
        os.chmod(private, 0o600)
        nobody = {"effective_user": "nobody"}
        with self.assertRaises(HTTPException) as caught:
            filepicker.resolve_server_path(nobody, private, [self.music], kind="file")
        self.assertEqual(caught.exception.status_code, 403)  # visible, but not readable by that user
        os.chmod(self.song, 0o644)
        self.assertEqual(filepicker.resolve_server_path(nobody, self.song, [self.music]), self.song)


class SharedLinks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        path = str(Path(self.tmp.name) / "core.db")
        init = sqlite3.connect(path)
        init.executescript("""
        CREATE TABLE file_folder_grants (id TEXT PRIMARY KEY, owner TEXT, name TEXT, root TEXT, device INTEGER, inode INTEGER,
            recipient TEXT, permissions TEXT, token_hash TEXT, created REAL);
        CREATE TABLE file_remote_folders (id TEXT PRIMARY KEY, owner TEXT, name TEXT, origin TEXT, grant_id TEXT, secret TEXT, created REAL);
        """)
        self.secret = "k" * 40
        self.grant = "a" * 32
        init.execute("INSERT INTO file_folder_grants VALUES (?,?,?,?,?,?,?,?,?,?)",
                     (self.grant, "alice", "Studio", "/srv", 0, 0, "https://home.example",
                      json.dumps(["read"]), hashlib.sha256(self.secret.encode()).hexdigest(), time.time()))
        init.execute("INSERT INTO file_remote_folders VALUES (?,?,?,?,?,?,?)",
                     ("f1", "alice", "Studio NAS", "https://nas.example", self.grant, self.secret, time.time()))
        init.commit(); init.close()

        @contextmanager
        def conn():
            c = sqlite3.connect(path)
            c.row_factory = sqlite3.Row
            try:
                with c:
                    yield c
            finally:
                c.close()
        self.old = (filepicker.get_conn, shared_files.get_conn)
        filepicker.get_conn = shared_files.get_conn = conn

    def tearDown(self):
        filepicker.get_conn, shared_files.get_conn = self.old
        self.tmp.cleanup()

    def test_link_is_accepted_by_the_sharing_side(self):
        url = filepicker.shared_file_url("alice", "f1", "Albums/one.mp3", 600)
        parts = urlsplit(url)
        self.assertEqual(f"{parts.scheme}://{parts.netloc}{parts.path}", f"https://nas.example/pub/shared-files/v1/{self.grant}/file")
        ticket = parse_qs(parts.query)["ticket"][0]
        request = type("R", (), {"headers": {}})()          # a media element sends no Origin
        row, path = shared_files._ticket(self.grant, ticket, request)
        self.assertEqual(path, "Albums/one.mp3")

    def test_link_expires_and_is_bound_to_its_path(self):
        ticket = parse_qs(urlsplit(filepicker.shared_file_url("alice", "f1", "a.mp3", -5)).query)["ticket"][0]
        with self.assertRaises(HTTPException):
            shared_files._ticket(self.grant, ticket, type("R", (), {"headers": {}})())
        good = parse_qs(urlsplit(filepicker.shared_file_url("alice", "f1", "a.mp3", 600)).query)["ticket"][0]
        payload, signature = good.split(".")
        forged = shared_files._encode(json.dumps({"path": "b.mp3", "expires": int(time.time()) + 600}).encode()) + "." + signature
        with self.assertRaises(HTTPException):
            shared_files._ticket(self.grant, forged, type("R", (), {"headers": {}})())

    def test_only_the_owner_and_valid_relative_paths(self):
        for owner, path, code in [("bob", "a.mp3", 404), ("alice", "../a.mp3", 400), ("alice", "/etc/passwd", 400), ("alice", "a//b.mp3", 400)]:
            with self.assertRaises(HTTPException) as caught:
                filepicker.shared_file_url(owner, "f1", path)
            self.assertEqual(caught.exception.status_code, code, (owner, path))
        with self.assertRaises(HTTPException):
            filepicker.shared_folder({"effective_user": "bob"}, "f1")
        self.assertEqual(filepicker.shared_folder({"effective_user": "alice"}, "f1")["name"], "Studio NAS")
        self.assertNotIn("secret", filepicker.shared_folder({"effective_user": "alice"}, "f1"))

    def test_disconnecting_the_folder_stops_new_links(self):
        with filepicker.get_conn() as c:
            c.execute("DELETE FROM file_remote_folders")
        with self.assertRaises(HTTPException) as caught:
            filepicker.shared_file_url("alice", "f1", "a.mp3")
        self.assertEqual(caught.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
