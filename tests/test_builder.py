"""App Builder: what a generated app may contain, what an archive may bring, and where the
AI may write. Run: venv/bin/python -m unittest tests.test_builder"""
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from fastapi import HTTPException  # noqa: E402
from backend import builder as B, builder_check as chk, builder_ai as AI, builder_sandbox as SB  # noqa: E402

LANGS = chk.LANGS
ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#2563eb"/></svg>'


def good_files():
    return {
        "index.html": '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1 data-i18n="title"></h1><script src="app.js"></script></body></html>',
        "style.css": "body{color:var(--text)}",
        "app.js": "document.title = mvm.t('title');",
        "i18n.json": json.dumps({l: {"title": "T"} for l in LANGS}),
        "icon.svg": ICON,
    }


class Env(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._old = B.PROJECTS_DIR
        B.PROJECTS_DIR = os.path.join(self.tmp.name, "projects")
        self.p = B.create_project("root", "Check App", "Utilities", False, False)
        self.pid = self.p["id"]

    def tearDown(self):
        B.PROJECTS_DIR = self._old
        self.tmp.cleanup()


class CheckTest(unittest.TestCase):
    def errors(self, files, **meta):
        return chk.check_project(files, {"category": meta.get("category", "Utilities")})["errors"]

    def test_a_clean_app_passes(self):
        self.assertEqual(self.errors(good_files()), [])

    def test_network_storage_and_system_access_are_refused(self):
        for code in ("fetch('/api/files')", "new XMLHttpRequest()", "localStorage.setItem('a','b')", "window.parent.document",
                     "eval('1')", "mvmOS.registerApp({})", "const u='/api/plugins'", "location.href='https://x.test'", "window.open('x')"):
            f = good_files()
            f["app.js"] = code
            self.assertTrue(self.errors(f), code)

    def test_html_and_css_rules(self):
        for key, text in (("index.html", '<iframe src="x"></iframe>'), ("index.html", '<script src="https://cdn.test/a.js"></script>'),
                          ("index.html", '<input type="date">'), ("style.css", "@import url(x.css);"),
                          ("style.css", "a{background:url(https://x.test/a.png)}")):
            f = good_files()
            f[key] = f[key] + text
            self.assertTrue(self.errors(f), text)

    def test_translations_must_cover_all_languages_and_keys(self):
        f = good_files()
        data = json.loads(f["i18n.json"])
        del data["ja"]
        f["i18n.json"] = json.dumps(data)
        self.assertTrue(any("ja" in e for e in self.errors(f)))
        f = good_files()
        f["app.js"] = "mvm.t('missing_key')"
        self.assertTrue(any("missing_key" in e for e in self.errors(f)))

    def test_the_apps_own_languages_decide_what_is_required(self):
        f = good_files()
        f["i18n.json"] = json.dumps({"en": {"title": "T"}})
        self.assertEqual(chk.check_project(f, {"category": "Utilities", "languages": ["en"]})["errors"], [])
        self.assertTrue(chk.check_project(f, {"category": "Utilities", "languages": ["en", "bg"]})["errors"])
        f["i18n.json"] = json.dumps({"bg": {"title": "Т"}})
        self.assertEqual(chk.check_project(f, {"category": "Utilities", "languages": ["bg"]})["errors"], [])
        self.assertEqual(chk.clean_languages(None), ["en"])
        self.assertEqual(chk.clean_languages(["xx", "ru", "bg"]), ["bg", "ru"])

    def test_icon_must_be_safe(self):
        f = good_files()
        f["icon.svg"] = ICON.replace("</svg>", "<script>1</script></svg>")
        self.assertTrue(self.errors(f))
        f["icon.svg"] = ICON.replace("<rect", "<rect onload='x'")
        self.assertTrue(self.errors(f))

    def test_syntax_errors_are_reported(self):
        f = good_files()
        f["app.js"] = "function ("
        self.assertTrue(any("app.js" in e for e in self.errors(f)))

    def test_file_names(self):
        for bad in ("../x.js", "/etc/passwd", "a/../../b.js", "UPPER.js", "api.py", "x.php", ".hidden.js", "a/b/c/d/e/f.js"):
            with self.assertRaises(ValueError):
                chk.safe_rel(bad)
        self.assertEqual(chk.safe_rel("./sub/game.js"), "sub/game.js")


class SandboxTest(unittest.TestCase):
    def test_a_normal_server_file_passes(self):
        src = ("import json\nfrom fastapi import APIRouter, Depends\nrouter = APIRouter()\n"
               "@router.get('/a')\ndef a(u=Depends(mvmx.profile_required)):\n    return {'x': json.dumps([1])}\n")
        self.assertEqual(SB.check_source(src, "server.py"), [])

    def test_ways_out_are_refused(self):
        for src in ("import os", "import subprocess", "from os import path", "import importlib", "open('/etc/passwd')",
                    "eval('1')", "exec('1')", "getattr(1, 'a')", "x = ().__class__", "x = [].__class__.__mro__",
                    "def f(g):\n    return g.gi_frame.f_back", "from fastapi import Request", "from fastapi.responses import FileResponse",
                    "import asyncio\nasyncio.create_subprocess_shell('x')", "import asyncio\nasyncio.get_running_loop()",
                    "from fastapi import APIRouter\nr = APIRouter()\nr.routes", "__builtins__", "from json import *",
                    "import socket", "import sqlite3", "x = '{0.__class__}'.format(1)"):
            self.assertTrue(SB.check_source(src, "server.py"), src)

    def test_the_runtime_has_no_way_to_import_or_open(self):
        b = SB.safe_builtins()
        for name in ("open", "eval", "exec", "compile", "getattr", "globals", "input"):
            self.assertNotIn(name, b)
        with self.assertRaises(ImportError):
            b["__import__"]("os")
        self.assertTrue(b["__import__"]("json"))

    def test_server_files_only_by_name(self):
        for ok in SB.SERVER_FILES:
            self.assertEqual(chk.safe_rel(ok), ok)
        for bad in ("api.py", "desktop.py", "scheduler.py", "sub/server.py", "backend.py"):
            with self.assertRaises(ValueError):
                chk.safe_rel(bad)

    def test_mp_game_only_for_games(self):
        files = good_files()
        files["mp_game.py"] = "class Game:\n    pass\n"
        res = chk.check_project(files, {"category": "Utilities"})
        self.assertTrue(any("games only" in e for e in res["errors"]))
        self.assertFalse(chk.check_project(files, {"category": "Games"})["errors"])


class LanguageTest(Env):
    def test_a_new_project_starts_with_english_and_an_old_one_keeps_all(self):
        self.assertEqual(B.project_languages(self.p), ["en"])
        old = dict(self.p)
        old.pop("languages")
        self.assertEqual(B.project_languages(old), list(chk.LANGS))
        p2 = B.create_project("root", "Two Tongues", "Utilities", False, False, languages=["bg", "en"])
        self.assertEqual(B.project_languages(p2), ["bg", "en"])


class WriteTest(Env):
    def test_writes_stay_inside_the_app_folder(self):
        self.assertEqual(B.write_text_file(self.pid, "sub/a.js", "1"), "sub/a.js")
        for bad in ("../project.json", "../../x.js", "a/../../b.js"):
            with self.assertRaises(ValueError):
                B.write_text_file(self.pid, bad, "x")
        outside = os.path.join(B._pdir(self.pid), "app")
        os.symlink("/etc", os.path.join(outside, "link"))
        with self.assertRaises(ValueError):
            B.write_text_file(self.pid, "link/passwd.txt", "x")
        self.assertNotIn("link", B.read_files(self.pid))

    def test_size_limits(self):
        with self.assertRaises(ValueError):
            B.write_text_file(self.pid, "big.js", "x" * (chk.MAX_TEXT_BYTES + 1))

    def test_snapshot_and_restore(self):
        B.write_text_file(self.pid, "a.txt", "one")
        sid = B.snapshot(self.pid, "t")
        B.write_text_file(self.pid, "a.txt", "two")
        B.restore_snapshot(self.pid, sid)
        self.assertEqual(B.read_files(self.pid)["a.txt"], "one")

    def test_tools_cannot_leave_the_project(self):
        turn = {"pid": self.pid, "changed": set(), "profile": ""}
        self.assertIn("Error", AI.run_tool(turn, "read_file", {"path": "../project.json"}))
        self.assertIn("Error", AI.run_tool(turn, "write_file", {"path": "../x.js", "content": "x"}))
        self.assertIn("Error", AI.run_tool(turn, "write_file", {"path": "run.py", "content": "x"}))
        self.assertIn("Error", AI.run_tool(turn, "no_such_tool", {}))
        self.assertTrue(AI.run_tool(turn, "write_file", {"path": "ok.js", "content": "1"}).startswith("ok"))
        self.assertIn("sign in", AI.run_tool(turn, "list_integrations", {}).lower())
        self.assertIn("Error", AI.run_tool(turn, "set_integrations", {"app_ids": ["budget"]}))


def archive(entries, meta=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        if meta is not False:
            z.writestr("builder.json", json.dumps(meta or {"format": B.FORMAT, "format_version": 1, "name": "Imp", "category": "Utilities"}))
        for k, v in entries.items():
            z.writestr(k, v)
    return buf.getvalue()


class ImportTest(Env):
    def test_round_trip(self):
        for k, v in good_files().items():
            B.write_text_file(self.pid, k, v)
        name, data = B.export_zip(self.pid, "root")
        imported = B.import_zip(data, "root")
        self.assertTrue(imported["imported"])
        self.assertNotEqual(imported["app_id"], self.p["app_id"])
        self.assertEqual(B.read_files(imported["id"])["app.js"], good_files()["app.js"])

    def test_an_ordinary_mvmos_app_is_refused(self):
        data = archive({"manifest.json": "{}", "public/main.js": "mvmOS.registerApp({})", "api.py": "x=1"}, meta=False)
        with self.assertRaises(HTTPException) as cm:
            B.import_zip(data, "root")
        self.assertIn("not an App Builder archive", cm.exception.detail)

    def test_unsafe_archives_are_refused(self):
        bad = [
            archive({"app/index.html": "x", "app/api.py": "x"}),
            archive({"app/index.html": "x", "premium/x.js": "x"}),
            archive({"app/index.html": "x", "app/../evil.js": "x"}),
            archive({"index.html": "x"}),
            archive({"app/index.html": "x"}, meta={"format": "other", "format_version": 1}),
            b"not a zip",
        ]
        for data in bad:
            with self.assertRaises(HTTPException):
                B.import_zip(data, "root")

    def test_an_imported_app_still_has_to_pass_the_checks(self):
        data = archive({"app/index.html": "<p>x</p>", "app/app.js": "fetch('/api/files')"})
        p = B.import_zip(data, "root")
        self.assertTrue(B.validate(p["id"])["errors"])
        data = archive({"app/index.html": "<p>x</p>", "app/server.py": "import subprocess"})
        p = B.import_zip(data, "root")
        self.assertTrue(any("subprocess" in e for e in B.validate(p["id"])["errors"]))


class TemplateTest(Env):
    def test_trusted_files_contain_nothing_from_the_app(self):
        p = dict(self.p, name='Evil"; alert(1); "', emoji="<script>")
        files = B.trusted_files(p)
        self.assertIn("public/main.js", files)
        compile(files["api.py"], "api.py", "exec")
        for name in ("main_app.js", "main_game.js", "mp_template.js", "game_i18n.js"):
            self.assertTrue(os.path.isfile(os.path.join(B.DATA_DIR, name)))
        game = B.trusted_files(dict(self.p, category="Games"))
        compile(game["mp_game.py"], "mp_game.py", "exec")
        self.assertIn("public/mp.js", game)


if __name__ == "__main__":
    unittest.main()
