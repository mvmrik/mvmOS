"""Public app endpoints retain their exact method and prefix through router includes."""
import unittest
from fastapi import FastAPI, APIRouter
from backend.app_backends import allows_no_session


class PublicBackendRoutes(unittest.TestCase):
    def test_nested_router_preserves_explicit_public_marker(self):
        router = APIRouter()

        @router.get('/key')
        def key():
            return 'public key'

        key.no_session_auth = True

        @router.put('/settings')
        def settings():
            return 'private'

        parent = APIRouter()
        parent.include_router(router, prefix='/app')
        app = FastAPI()
        app.include_router(parent, prefix='/api')
        for method, path, expected in [
            ('GET', '/api/app/key', True),
            ('POST', '/api/app/key', False),
            ('GET', '/app/key', False),
            ('GET', '/api/app/key/extra', False),
            ('PUT', '/api/app/settings', False),
            ('GET', '/unknown', False),
        ]:
            with self.subTest(method=method, path=path):
                scope = {'type': 'http', 'path': path, 'root_path': '', 'method': method, 'headers': []}
                self.assertEqual(allows_no_session(app.routes, scope), expected)
